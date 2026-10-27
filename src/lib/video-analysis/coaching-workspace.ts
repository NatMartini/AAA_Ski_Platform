import {createHash} from "node:crypto";
import {z} from "zod";
import type {ActiveUser} from "../auth/require-user";
import {prisma} from "../prisma";
import {readJsonBody} from "../request-body";
import {isTrustedApiWrite} from "../request-origin";
import {requestFreeSkiWorkspaceResource, requestFreeSkiReportResource, readFreeSkiReportJson} from "../freeski/adapter";
import {coachingReportSchema} from "../freeski/report-v2";
import {DynamicReportError,loadDynamicReportSource} from "./dynamic-report";

const turn=z.string().regex(/^turn_\d{1,5}$/), hash=z.string().regex(/^[a-f0-9]{64}$/);
const anchor=z.object({phase:z.enum(["start","initiation","apex","completion","end"]),time_sec:z.number().finite().nonnegative()}).strict();
const view=z.enum(["unknown","front","rear","left_side","right_side","oblique_front","oblique_rear"]);
const direction=z.enum(["left","right","unknown"]), mirror=z.enum(["original","mirrored","unknown"]);
const stage=z.enum(["unknown","snowplow_glide_stop","linked_snowplow","stem_matching","parallel"]);
const revision=z.number().int().nonnegative(), notes=z.string().max(2000);
const metadata=z.object({title:z.string().min(1).max(160),action:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  learning_stage:stage,camera_view:view,direction,mirror_state:mirror,start_time:z.number().finite().nonnegative(),
  end_time:z.number().finite().positive(),phase_anchors:z.array(anchor).max(12).default([]),
  license:z.object({confirmed:z.boolean(),basis:z.enum(["owned","explicit_permission"]),allow_public_display:z.boolean()}).strict()});
const workspace=z.object({schema_version:z.literal("coaching_workspace.v1"),job_id:z.string().regex(/^[a-f0-9]{32}$/),generation:hash,
  action:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),learning_stage:stage.nullable().optional(),revision,
  actor:z.object({id:z.string().max(120),can_review:z.boolean()}),consent:z.object({allowed:z.boolean(),can_change:z.boolean()}),
  annotations:z.array(z.object({turn_id:turn,phase_anchors:z.array(anchor).max(12),camera_view:view,direction,mirror_state:mirror,phase_anchors_reviewed:z.boolean()})).max(100),
  selected_references:z.array(z.object({turn_id:turn,version_id:hash,status:z.enum(["available","unavailable"])})).max(100),
  turns:z.array(z.object({turn_id:turn,start_time:z.number().finite().nonnegative(),end_time:z.number().finite().positive()})).max(100),
  capabilities:z.object({technical_scoring_authorized:z.literal(false),official_csia_numeric_standard:z.literal(false)})});
const item=z.object({schema_version:z.literal("reference_item.v1"),reference_id:z.string().regex(/^ref_[a-f0-9]{32}$/),revision:z.number().int().positive(),
  state:z.enum(["draft","submitted","approved","published","withdrawn","rejected"]),split:z.enum(["reference","training","tuning","test"]),
  metadata,review_note:notes.nullable(),version:hash.nullable(),owner_id:z.string().regex(/^aaa:(owner|coach):[a-f0-9]{64}$/)});
const published=z.object({schema_version:z.literal("reference_manifest.v1"),reference_id:z.string().regex(/^ref_[a-f0-9]{32}$/),version:hash,
  reference_kind:z.literal("platform_reviewed_demonstration"),official_csia_numeric_standard:z.literal(false),
  metadata:metadata.omit({title:true,license:true}),phase_anchors_reviewed:z.boolean(),license:z.object({public_display:z.literal(true)}),
  review_status:z.literal("independently_approved"),technical_scoring_authorized:z.literal(false)});
const exportState=z.object({version:z.literal(1),exportId:z.string().regex(/^[a-f0-9]{32}$/),state:z.enum(["queued","running","ready","failed","cancelled","expired"]),
  format:z.enum(["mp4","webp"]),mode:z.enum(["user_only","reviewed_comparison"]),expiresAt:z.number().finite(),
  result:z.object({bytes:z.number().int().positive().max(8*1024*1024),format:z.enum(["mp4","webp"]).optional(),
    duration_sec:z.number().finite().nonnegative().optional(),frame_count:z.number().int().nonnegative().optional()}).nullable(),error:z.string().max(80).nullable()});
const observations=z.object({schema_version:z.literal("observation_job.v1"),jobId:z.string().regex(/^[a-f0-9]{32}$/),deploymentId:z.string().max(100),
  sourceGeneration:hash,status:z.enum(["not_requested","unavailable","queued","running","ready","failed","cancelled"]),attempts:z.number().int().nonnegative(),
  observationGeneration:hash.nullable(),observationId:z.string().regex(/^ob_[a-f0-9]{64}$/).nullable(),
  summary:z.object({schema_version:z.literal("observation_summary.v1"),feature_count:z.number().int().nonnegative().max(512),
    event_count:z.number().int().nonnegative(),timestamp_status:z.string().max(40),feature_ids:z.array(z.string().regex(/^[a-z][a-z0-9_]{0,100}$/)).max(512).optional(),
    availability:z.object({camera_motion:z.enum(["available","unavailable"]).optional(),persistent_identity:z.enum(["available","unavailable"]).optional(),
      equipment:z.enum(["available","unavailable"]).optional(),research_3d:z.enum(["available","unavailable"]).optional()}).optional(),
    sampling:z.object({coverage_fraction:z.number().min(0).max(1),observed_frame_count:z.number().int().nonnegative(),source_frame_count:z.number().int().nonnegative(),
      complete_native_frame_coverage:z.boolean()}).optional()}).nullable(),
  errorCode:z.string().max(80).nullable()});

type Input={scope:string;jobId:string;resource:string[];request:Request;user:ActiveUser};
export async function handleCoachingWorkspace(input:Input):Promise<Response> {
  const {request,user}=input, route=input.resource.join("/"),method=request.method;
  if(!isTrustedApiWrite(request))throw new DynamicReportError(403,"invalid-origin");
  const job=await loadDynamicReportSource(input.scope,input.jobId,user);
  if(!job.upstreamJobId||!job.upstreamDeploymentId||job.upstreamApiVersion!==2)throw new DynamicReportError(409,"dynamic-report-unavailable");
  const source={jobId:job.upstreamJobId,deploymentId:job.upstreamDeploymentId};
  const owned=input.scope==="account"||("bookingId" in job && !!await prisma.booking.findFirst({where:{id:job.bookingId,accountId:user.id},select:{id:true}}));
  if(!owned&&user.role!=="COACH")throw new DynamicReportError(404,"not-found");
  if(route==="workspace/consent"&&!owned)throw new DynamicReportError(403,"source-owner-required");
  const role=owned?"owner":"coach";
  let body:unknown=undefined;
  try {
  if(["POST","PATCH"].includes(method)){
    const raw=await readJsonBody(request,{maxBytes:16384,allowEmpty:true});
    if(route==="workspace/consent")body=z.object({expected_revision:revision,allow_reference_display:z.boolean(),license_basis:z.enum(["owned","explicit_permission"])}).strict().parse(raw);
    else if(route==="workspace/annotations")body=z.object({expected_revision:revision,turn_id:turn,phase_anchors:z.array(anchor).max(12),camera_view:view,direction,mirror_state:mirror}).strict().parse(raw);
    else if(route==="workspace/reference")body=z.object({expected_revision:revision,turn_id:turn,version_id:hash.nullable()}).strict().parse(raw);
    else if(route==="observations")body=z.object({}).strict().parse(raw);
    else if(route==="exports")body=z.object({client_request_id:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/),turn_id:turn,
      format:z.enum(["mp4","webp"]),mode:z.enum(["user_only","reviewed_comparison"]),speed:z.union([z.literal(.25),z.literal(.5),z.literal(1)]),
      timing:z.enum(["original","phase"]),start_time:z.number().finite().nonnegative().optional(),end_time:z.number().finite().positive().optional()}).strict().parse(raw);
    else if(route==="references/items"){
      if(!owned)throw new DynamicReportError(403,"source-owner-required");
      body={...metadata.extend({split:z.enum(["reference","training","tuning","test"]).default("reference")}).strict().parse(raw),job_id:source.jobId};
    }else if(/^references\/items\/ref_[a-f0-9]{32}\/review$/.test(route)){
      if(user.role!=="COACH")throw new DynamicReportError(403,"coach-required");
      body=z.object({expected_revision:z.number().int().positive(),approve:z.boolean(),note:notes.default("")}).strict().parse(raw);
    }else if(/^references\/items\/ref_[a-f0-9]{32}\/(submit|publish|withdraw)$/.test(route))body=z.object({expected_revision:z.number().int().positive()}).strict().parse(raw);
    else if(/^references\/items\/ref_[a-f0-9]{32}$/.test(route)&&method==="PATCH")body=metadata.extend({expected_revision:z.number().int().positive()}).strict().parse(raw);
    else if(route==="evidence"){
      const query=z.object({evidence_ids:z.array(z.string().max(200)).min(1).max(12),fields:z.array(z.string().regex(/^[a-z][a-z0-9_]{0,100}$/)).min(1).max(12),
        start_time:z.number().finite().nonnegative(),end_time:z.number().finite().positive(),max_samples:z.number().int().min(2).max(512),max_bytes:z.number().int().min(256).max(65536)}).strict().parse(raw);
      const reportResponse=await requestFreeSkiReportResource({...source,resource:"report",signal:request.signal});
      if(!reportResponse.ok)throw new DynamicReportError(503,"evidence-unavailable");
      const report=coachingReportSchema.parse(await readFreeSkiReportJson(reportResponse));
      if(report.jobId!==source.jobId||report.deploymentId!==source.deploymentId||!/^ev_[a-f0-9]{64}$/.test(report.evidenceId??""))throw new DynamicReportError(502,"invalid-provider-identity");
      const prefixes=new Set(query.evidence_ids.map(eid=>/^ob_[a-f0-9]{64}:/.exec(eid)?.[0]));
      let observationId:string|undefined;
      if(prefixes.size!==1)throw new DynamicReportError(400,"invalid-evidence-query");
      if([...prefixes][0]){
        const status=await requestFreeSkiWorkspaceResource({...source,resource:["observations"],method:"GET",actorHash:createHash("sha256").update(user.id).digest("hex"),role,signal:request.signal});
        if(!status.ok)throw new DynamicReportError(409,"observations-unavailable");
        const observed=observations.parse(await readFreeSkiReportJson(status));
        if(observed.status!=="ready"||observed.jobId!==source.jobId||observed.deploymentId!==source.deploymentId||observed.sourceGeneration!==report.evidenceId!.slice(3)||observed.observationId+":"!==[...prefixes][0])throw new DynamicReportError(409,"observation-source-changed");
        observationId=observed.observationId!;
      }
      body={...query,job_id:source.jobId,deployment_id:source.deploymentId,generation:report.evidenceId!.slice(3),evidence_id:report.evidenceId,
        ...(observationId?{observation_id:observationId}:{})};
    }else throw new DynamicReportError(404,"not-found");
  }
  } catch(error) { if(error instanceof z.ZodError)throw new DynamicReportError(400,"invalid-request");throw error; }
  const actorHash=createHash("sha256").update(user.id).digest("hex");
  const response=await requestFreeSkiWorkspaceResource({...source,resource:input.resource,method,actorHash,
    role:user.role==="COACH"&&route.startsWith("references/")&&method==="GET"||route.endsWith("/review")?"coach":role,
    body,range:route.endsWith("/file")?request.headers.get("range")??undefined:undefined,signal:request.signal});
  const recheck=async()=>{
    const current=await loadDynamicReportSource(input.scope,input.jobId,user);
    if(current.upstreamJobId!==source.jobId||current.upstreamDeploymentId!==source.deploymentId||current.upstreamApiVersion!==2)throw new DynamicReportError(409,"analysis-source-changed");
  };
  try{await recheck();}catch(error){await response.body?.cancel();throw error;}
  const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"};
  if(response.status===416){await response.body?.cancel();const range=response.headers.get("content-range");return new Response(null,{status:416,headers:{...headers,...(range&&/^bytes \*\/\d+$/.test(range)?{"Content-Range":range}:{})}});}
  if(!response.ok){await response.body?.cancel();throw new DynamicReportError([400,403,404,409,410,413,422,429].includes(response.status)?response.status:503,"coaching-workspace-unavailable");}
  if(route.endsWith("/file")){
    const mime=response.headers.get("content-type")?.split(";")[0],length=Number(response.headers.get("content-length"));
    const range=response.headers.get("content-range"),match=range?/^bytes (\d+)-(\d+)\/(\d+)$/.exec(range):null;
    if(!response.body||!["video/mp4","image/webp"].includes(mime??"")||!Number.isSafeInteger(length)||length<=0||length>8*1024*1024||
      (response.status===206&&!match)||(range&&(!match||!match.slice(1).map(Number).every(Number.isSafeInteger)||Number(match[2])>=Number(match[3])||Number(match[1])>Number(match[2])||Number(match[2])-Number(match[1])+1!==length))){await response.body?.cancel();throw new DynamicReportError(502,"invalid-provider-media");}
    let sent=0;const stream=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({async transform(chunk,controller){
      await recheck();sent+=chunk.byteLength;if(sent>length)throw new Error("Export exceeded byte budget");controller.enqueue(chunk);
    },flush(){if(sent!==length)throw new Error("Incomplete export");}}));
    return new Response(stream,{status:response.status,headers:{...headers,"Content-Type":mime!,"Content-Length":String(length),"Accept-Ranges":"bytes",...(range?{"Content-Range":range}:{})}});
  }
  const raw=await readFreeSkiReportJson(response);await recheck();
  let safe:unknown;
  if(route.startsWith("workspace")){
    const value=workspace.parse(raw);if(value.job_id!==source.jobId)throw new DynamicReportError(502,"invalid-provider-identity");safe=value;
  }else if(route==="observations"){
    const value=observations.parse(raw);if(value.jobId!==source.jobId||value.deploymentId!==source.deploymentId)throw new DynamicReportError(502,"invalid-provider-identity");safe=value;
  }else if(route.startsWith("exports"))safe=method==="DELETE"?z.object({ok:z.literal(true),state:z.literal("cancelled")}).parse(raw):exportState.parse(raw);
  else if(route==="references/items"&&method==="GET")safe=z.object({items:z.array(item).max(200)}).parse(raw);
  else if(route==="references/published")safe=z.object({items:z.array(published).max(200)}).parse(raw);
  else if(route.startsWith("references/"))safe=item.parse(raw);
  else if(route==="evidence"){
    // Query replies contain only bounded measurement arrays; reject any non-data fields.
    const encoded=JSON.stringify(raw);if(Buffer.byteLength(encoded)>65536)throw new DynamicReportError(502,"invalid-provider-evidence");
    const floats=z.array(z.number().finite().nullable()).max(512), masks=z.record(z.string().regex(/^[a-z][a-z0-9_]{0,100}$/),z.array(z.boolean()).max(512));
    const value=z.object({schema_version:z.literal("evidence_window.v1"),job_id:z.literal(source.jobId),deployment_id:z.literal(source.deploymentId),
      generation:hash,evidence_id:z.string().regex(/^ev_[a-f0-9]{64}$/),evidence_ids:z.array(z.string().max(200)).max(12),turn_id:turn,
      timestamp_status:z.string().max(40),timestamps_sec:z.array(z.number().finite().nonnegative()).max(512),source_sample_indices:z.array(z.number().int().nonnegative()).max(512),
      signals:z.record(z.string().regex(/^[a-z][a-z0-9_]{0,100}$/),floats),observed_mask:masks,valid_mask:masks,mask_source:z.string().max(80),
      sampling:z.object({source_count:z.number().int().nonnegative(),returned_count:z.number().int().nonnegative().max(512),method:z.string().max(80),interpolated:z.literal(false)}),
      interpretation_status:z.literal("observation_only"),technique_scoring_authorized:z.literal(false),observation_id:z.string().regex(/^ob_[a-f0-9]{64}$/).optional(),
      observation_generation:hash.optional(),source_frame_indices:z.array(z.number().int().nonnegative()).max(512).optional()}).parse(raw);
    if(Object.keys(value.signals).length>12||Object.values(value.signals).some(v=>v.length!==value.timestamps_sec.length)||
      value.evidence_id!=="ev_"+value.generation||value.timestamps_sec.some((v,i)=>i>0&&v<=value.timestamps_sec[i-1]))throw new DynamicReportError(502,"invalid-provider-evidence");
    safe=value;
  }else throw new DynamicReportError(404,"not-found");
  return Response.json(safe,{status:response.status,headers});
}
