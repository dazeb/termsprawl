import { readFileSync } from "node:fs"
import type { SettingsHook } from "../shared/types"
export interface HookFile { path:string; agent:string; source?: "managed"|"legacy" }
const EVENTS=["PreToolUse","PostToolUse","Notification","Stop","UserPromptSubmit","PermissionRequest","SubagentStop","SessionStart","SessionEnd","SubagentStart","PreCompact","PostCompact"]
const secret=/([?&](?:key|token|secret|api_key|password)=)[^&\s"']+/gi
function clean(s:string){return s.replace(secret,"$1[redacted]").replace(/\b(sk-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+)\b/g,"[redacted]")}
export function inventoryHooks(files:HookFile[]):SettingsHook[]{const out:SettingsHook[]=[]; for(const f of files){let raw;try{raw=readFileSync(f.path,"utf8")}catch{continue}; const managed= f.source || (raw.includes("__termsprawlManaged")||raw.includes("__termsprawl" ) ? "managed":"legacy"); for(const event of EVENTS){const re=new RegExp(`(?:hooks\\.)?${event}[^\\n]*|${event}`); if(!re.test(raw))continue; const line=raw.split("\n").find(x=>x.includes(event))||""; const cmd=(raw.match(/(?:command|url)\s*=\s*["']([^"']+)/)?.[1]||line).trim(); out.push({id:`${f.agent}:${event}:${managed}:${out.length}`,event,agent:f.agent,source:managed,command:clean(cmd).slice(0,300),enabled:true})}} return out.sort((a,b)=>a.id.localeCompare(b.id))}
