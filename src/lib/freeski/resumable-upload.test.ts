import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {mkdtemp,writeFile,rm,utimes} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash} from "node:crypto";
import {parseFreeSkiActionId} from "./actions";
import {ResumableUploadError,submitResumableVideo} from "./resumable-upload";

const selection=parseFreeSkiActionId("parallel")!;
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
describe("provider resumable transport",()=>{
  let root:string,file:string;
  const bytes=Buffer.alloc(524288*2+128,42),uploadId="a".repeat(32),jobId="b".repeat(32);
  beforeEach(async()=>{root=await mkdtemp(path.join(os.tmpdir(),"ski-chunks-"));vi.stubEnv("STORAGE_DIR",root);file=path.join(root,"clip.mp4");await writeFile(file,bytes);});
  afterEach(async()=>{vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});});
  function provider(received:number[]=[],state="receiving"){
    const chunks:number[]=[];
    const send=vi.fn(async(endpoint:string,init:RequestInit)=>{
      if(endpoint.endsWith("/uploads")){
        const data=JSON.parse(String(init.body));expect(data.client_request_id).toBe("aaa:account:local-job");
        expect(data.total_bytes).toBe(bytes.length);expect(data.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
        return json({version:2,uploadId,state,chunkSize:524288,totalChunks:3,receivedChunks:received});
      }
      if(endpoint.endsWith("/complete"))return json({state:"submitted",jobId});
      const index=Number(endpoint.split("/").at(-1));chunks.push(index);
      expect(Buffer.from(init.body as Uint8Array)).toEqual(bytes.subarray(index*524288,Math.min(bytes.length,(index+1)*524288)));
      expect((init.headers as Record<string,string>)["X-Chunk-SHA256"]).toBe(createHash("sha256").update(init.body as Uint8Array).digest("hex"));
      return json({ok:true});
    });
    return {send,chunks};
  }
  const run=(file:string,send:Parameters<typeof submitResumableVideo>[0]["send"],signal?:AbortSignal)=>submitResumableVideo({videoPath:file,maxBytes:2000000,requestKey:"aaa:account:local-job",selection,send,signal});
  it("sends bounded chunks and skips chunks already confirmed by the provider",async()=>{
    const p=provider([1]);expect(await run(file,p.send)).toBe(jobId);expect(p.chunks).toEqual([0,2]);
  });
  it("names the skier's current level in the upload session only when the request has one",async()=>{
    for(const [id,level] of [["parallel",undefined],["improvement:level2:parallel","level2"]] as const){
      const p=provider();expect(await submitResumableVideo({videoPath:file,maxBytes:2000000,requestKey:"aaa:account:local-job",selection:parseFreeSkiActionId(id)!,send:p.send})).toBe(jobId);
      const session=p.send.mock.calls.find(([endpoint])=>endpoint.endsWith("/uploads"))!;
      const body=JSON.parse(String(session[1].body));
      expect(body).toMatchObject({action_name:"parallel",path_type:"improvement",level:null});expect(body.current_level).toBe(level);
    }
  });
  it("recovers assembling/submitting by idempotent complete without resending bytes",async()=>{
    for(const state of ["assembling","submitting"]){const p=provider([0,1,2],state);expect(await run(file,p.send)).toBe(jobId);expect(p.chunks).toEqual([]);}
  });
  it("never reads outside the private storage root",async()=>{
    const outside=path.join(os.tmpdir(),"not-private.mp4"),p=provider();await expect(run(outside,p.send)).rejects.toBeInstanceOf(ResumableUploadError);expect(p.send).not.toHaveBeenCalled();
  });
  it("retains uncertainty after a lost completion response",async()=>{
    const p=provider([0,1,2]);const send=async(endpoint:string,init:RequestInit)=>endpoint.endsWith("/complete")?json({error:"pending"},503):p.send(endpoint,init);
    await expect(run(file,send)).rejects.toMatchObject({reason:"unavailable"});expect(p.chunks).toEqual([]);
  });
  it("rejects malformed resume indices without sending any chunk",async()=>{
    const p=provider([1,1]);await expect(run(file,p.send)).rejects.toMatchObject({reason:"invalid-response"});expect(p.chunks).toEqual([]);
  });
  it("cancellation stops completion and later chunks",async()=>{
    const p=provider(),abort=new AbortController();
    const send=async(endpoint:string,init:RequestInit)=>{const response=await p.send(endpoint,init);if(endpoint.includes("/chunks/"))abort.abort();return response;};
    await expect(run(file,send,abort.signal)).rejects.toMatchObject({reason:"cancelled"});expect(p.chunks).toEqual([0]);
    expect(p.send.mock.calls.some(([endpoint])=>endpoint.endsWith("/complete"))).toBe(false);
  });
  it("does not commit a source file that changes during transfer",async()=>{
    const p=provider();const send=async(endpoint:string,init:RequestInit)=>{const response=await p.send(endpoint,init);if(endpoint.includes("/chunks/0"))await utimes(file,new Date(),new Date(Date.now()+10_000));return response;};
    await expect(run(file,send)).rejects.toMatchObject({reason:"invalid-video"});
    expect(p.send.mock.calls.some(([endpoint])=>endpoint.endsWith("/complete"))).toBe(false);
  });
});
