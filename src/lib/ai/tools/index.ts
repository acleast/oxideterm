// Copyright (C) 2026 AnalyseDeCircuit
// SPDX-License-Identifier: GPL-3.0-only

export {
  BUILTIN_TOOLS,
  SFTP_TOOL_DEFS,
  IDE_TOOL_DEFS,
  LOCAL_TOOL_DEFS,
  SETTINGS_TOOL_DEFS,
  POOL_TOOL_DEFS,
  MONITOR_TOOL_DEFS,
  SESSION_MGR_TOOL_DEFS,
  PLUGIN_TOOL_DEFS,
  MCP_RESOURCE_TOOL_DEFS,
  RAG_TOOL_DEFS,
  ALL_BUILTIN_TOOL_DEFS,
  BUILTIN_TOOL_SPECS,
  TOOL_SPEC_BY_NAME,
  READ_ONLY_TOOLS,
  WRITE_TOOLS,
  EXPERIMENTAL_TOOLS,
  CONTEXT_FREE_TOOLS,
  SESSION_ID_TOOLS,
  SSH_ONLY_TOOLS,
  SFTP_ONLY_TOOLS,
  IDE_ONLY_TOOLS,
  LOCAL_ONLY_TOOLS,
  SETTINGS_ONLY_TOOLS,
  POOL_ONLY_TOOLS,
  MONITOR_ONLY_TOOLS,
  SESSION_MGR_ONLY_TOOLS,
  PLUGIN_MGR_ONLY_TOOLS,
  TOOL_GROUPS,
  getAllToolSpecs,
  getToolSpec,
  getToolDefinitionByName,
  createExternalToolSpec,
  getToolsForContext,
  isCommandDenied,
  getDeniedCommands,
  hasDeniedCommands,
} from './toolDefinitions';
export type {
  ToolDomain,
  ToolIntent,
  ToolSideEffect,
  ToolSpec,
  ToolTargetRequirement,
  ExternalToolSpecInput,
} from './toolDefinitions';
export { executeTool, type ToolExecutionContext } from './toolExecutor';
export type {
  ToolCapability,
  ToolResultEnvelope,
  ToolResultError,
  ToolResultMeta,
  ToolRisk,
  ToolTarget,
  ToolTargetKind,
} from './protocol';
export {
  createToolResultEnvelope,
  createToolTarget,
  decideToolApproval,
  formatToolResultForModel,
  fromLegacyToolResult,
  hasTargetCapability,
  inferToolRisk,
  isHighRiskToolRisk,
  sanitizeToolArguments,
  toLegacyToolResult,
} from './protocol';
export {
  getToolsForPlan,
  isControlSequenceRequest,
  inferToolIntents,
  scoreToolsForRequest,
} from './toolPlanner';
export type {
  ToolScore,
  ToolIntentInferenceInput,
  ToolPlanInput,
} from './toolPlanner';
export {
  classifyToolObligation,
} from './toolObligation';
export type {
  ToolObligation,
  ToolObligationInput,
  ToolObligationMode,
} from './toolObligation';
export {
  pluginAiToolToDefinition,
  pluginAiToolToSpec,
  pluginManifestToAiToolSpecs,
} from './pluginToolSpecs';
