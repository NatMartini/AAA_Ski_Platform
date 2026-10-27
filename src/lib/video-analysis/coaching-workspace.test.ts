import {beforeEach,expect,it,vi} from "vitest";
import {createHash} from "node:crypto";
import type {ActiveUser} from "../auth/require-user";
const mocks=vi.hoisted(()=>({account:vi.fn(),bookingJob:vi.fn(),booking:vi.fn(),request:vi.fn(),report:vi.fn()}));
vi.mock("../prisma",()=>({prisma:{accountAnalysisJob:{findFirst:mocks.account},videoAnalysisJob:{findFirst:mocks.bookingJob},booking:{findFirst:mocks.booking}}}));
vi.mock("../freeski/adapter",()=>({requestFreeSkiWorkspaceResource:mocks.request,requestFreeSkiReportResource:mocks.report,readFreeSkiReportJson:(r:Response)=>r.json(),FreeSkiError:class extends Error{}}));
import {handleCoachingWorkspace} from "./coaching-workspace";
const user={id:"owner",role:"CUSTOMER"} as ActiveUser,job="a".repeat(32),deployment="separate-integration";
const row={id:"local",upstreamJobId:job,upstreamDeploymentId:deployment,upstreamApiVersion:2};
function state(){return {schema_version:"coaching_workspace.v1",job_id:job,generation:"b".repeat(64),action:"parallel",revision:0,
  actor:{id:"aaa:owner:"+createHash("sha256").update(user.id).digest("hex"),can_review:false},consent:{allowed:false,can_change:true},annotations:[],selected_references:[],
  turns:[{turn_id:"turn_0",start_time:0,end_time:3}],capabilities:{technical_scoring_authorized:false,official_csia_numeric_standard:false}};}
function input(route:string,method="GET",body?:unknown,options:{scope?:string;user?:ActiveUser;headers?:Record<string,string>}={}){return {scope:options.scope??"account",jobId:"local",resource:route.split("/"),user:options.user??user,
  request:new Request("http://localhost/api/analysis",{method,headers:{Origin:"http://localhost",...options.headers},...(body!==undefined?{body:JSON.stringify(body)}:{})})};}
beforeEach(()=>{vi.resetAllMocks();mocks.account.mockResolvedValue(row);mocks.bookingJob.mockResolvedValue({...row,bookingId:"order"});mocks.booking.mockResolvedValue(null);mocks.request.mockImplementation(async()=>Response.json(state()));});
it("binds delegation to the current user and fixed upstream identity",async()=>{
  const response=await handleCoachingWorkspace(input("workspace"));expect(response.status).toBe(200);
  expect(mocks.request.mock.calls[0][0]).toMatchObject({jobId:job,deploymentId:deployment,actorHash:createHash("sha256").update("owner").digest("hex"),role:"owner"});
});
it("rejects cross-site cookie mutations before network or database work",async()=>{
  await expect(handleCoachingWorkspace(input("observations","POST",{},{headers:{Origin:"https://attacker.example",Cookie:"session=test"}}))).rejects.toMatchObject({status:403});expect(mocks.request).not.toHaveBeenCalled();expect(mocks.account).not.toHaveBeenCalled();
});
it("an assigned coach cannot license a student's video",async()=>{
  await expect(handleCoachingWorkspace(input("workspace/consent","POST",{expected_revision:0,allow_reference_display:true,license_basis:"owned"},{scope:"booking",user:{...user,id:"coach",role:"COACH"}}))).rejects.toMatchObject({status:403});expect(mocks.request).not.toHaveBeenCalled();
});
it("does not forward a forged upstream job in reference creation",async()=>{
  await expect(handleCoachingWorkspace(input("references/items","POST",{job_id:"forged"}))).rejects.toMatchObject({status:400});expect(mocks.request).not.toHaveBeenCalled();
});
it("strips unexpected provider source fields",async()=>{
  mocks.request.mockResolvedValue(Response.json({...state(),video_path:"private",sha1:"private",actor:{...state().actor,password:"secret"}}));
  const response=await handleCoachingWorkspace(input("workspace"));expect(await response.text()).not.toMatch(/private|password|secret/);
});
it("rejects a workspace for another job",async()=>{
  mocks.request.mockResolvedValue(Response.json({...state(),job_id:"c".repeat(32)}));await expect(handleCoachingWorkspace(input("workspace"))).rejects.toMatchObject({status:502});
});
it("rechecks local grants after the provider replies",async()=>{
  mocks.account.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
  const cancel=vi.fn();mocks.request.mockResolvedValue(new Response(new ReadableStream({cancel})));
  await expect(handleCoachingWorkspace(input("workspace"))).rejects.toMatchObject({status:404});expect(cancel).toHaveBeenCalledOnce();
});
it("does not release stale deployment resources",async()=>{
  mocks.account.mockResolvedValueOnce(row).mockResolvedValueOnce({...row,upstreamDeploymentId:"different"});
  await expect(handleCoachingWorkspace(input("workspace"))).rejects.toMatchObject({code:"analysis-source-changed"});
});
it("preserves CAS conflicts without exposing provider details",async()=>{
  mocks.request.mockResolvedValue(Response.json({detail:"C:/private/password"},{status:409}));
  await expect(handleCoachingWorkspace(input("workspace/reference","POST",{expected_revision:2,turn_id:"turn_0",version_id:null}))).rejects.toMatchObject({status:409,message:"coaching-workspace-unavailable"});
});
it("exports only bounded typed private files",async()=>{
  mocks.request.mockResolvedValue(new Response(new Uint8Array([1,2,3]),{status:206,headers:{"Content-Type":"image/webp","Content-Length":"3","Content-Range":"bytes 2-4/8"}}));
  const response=await handleCoachingWorkspace(input("exports/"+"e".repeat(32)+"/file","GET",undefined,{headers:{Range:"bytes=2-4"}}));
  expect(response.status).toBe(206);expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1,2,3]);expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it.each(["8388609","0","invalid"])("refuses export byte budgets before streaming: %s",async size=>{
  const cancel=vi.fn();mocks.request.mockResolvedValue(new Response(new ReadableStream({cancel}),{headers:{"Content-Type":"video/mp4","Content-Length":size}}));
  await expect(handleCoachingWorkspace(input("exports/"+"e".repeat(32)+"/file"))).rejects.toMatchObject({status:502});expect(cancel).toHaveBeenCalledOnce();
});
it("stops exported bytes after local permission is revoked",async()=>{
  mocks.account.mockResolvedValueOnce(row).mockResolvedValueOnce(row).mockResolvedValueOnce(null);
  mocks.request.mockResolvedValue(new Response(new Uint8Array([1,2,3]),{headers:{"Content-Type":"video/mp4","Content-Length":"3"}}));
  const response=await handleCoachingWorkspace(input("exports/"+"e".repeat(32)+"/file"));await expect(response.arrayBuffer()).rejects.toMatchObject({status:404});
});
