// Base types and interfaces for the orchestration hub

export type AgentStatus = 'ready' | 'busy' | 'offline';
export type WorkflowStatus = 'pending' | 'in-progress' | 'complete' | 'failed';
export type ToolStatus = 'active' | 'pending-validation' | 'disabled';

export interface AgentProfile {
  id: string;
  name: string;
  capability_tags: string[];
  status: AgentStatus;
  tool_ids: string[];
  communication_endpoint: string;
}

export interface ToolDefinition {
  id: string;
  name: string;
  domains: string[];
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  status: ToolStatus;
}

export interface SharedMemoryRecord {
  id: string;
  agent_id: string;
  workflow_task_id?: string;
  embedding_hash: string;
  content: string;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export interface WorkflowTask {
  id: string;
  operator_id: string;
  description: string;
  selected_agent_ids: string[];
  tool_invocations: ToolInvocation[];
  shared_memory_ids: string[];
  status: WorkflowStatus;
  final_response?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ToolInvocation {
  tool_id: string;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  status: 'success' | 'failure';
  error?: string;
  timestamp: Date;
}

export interface WorkflowRequest {
  operator_id: string;
  description: string;
  selected_agent_ids: string[];
  tool_preferences?: string[];
}

export interface AgentSummary {
  id: string;
  name: string;
  status: AgentStatus;
  capability_tags: string[];
}

