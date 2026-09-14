import type { SettingsCommand } from "../shared/types"
import { detectSlashCommand } from "./chat/conversation"
export const BUILTIN_COMMANDS:SettingsCommand[]=[{name:"/clear",description:"Clear the conversation",source:"built-in",available:true},{name:"/model",description:"Change the chat model",source:"built-in",available:true},{name:"/system",description:"Set the system prompt",source:"built-in",available:true},{name:"/cost",description:"Show estimated usage cost",source:"built-in",available:true}]
export function discoverCommands(){return BUILTIN_COMMANDS.map(x=>({...x}))}
export function commandsHaveParserParity(){return BUILTIN_COMMANDS.every(c=>detectSlashCommand(c.name)?.command)}
export {detectSlashCommand}
