// MCP Server configuration types for Claude Code
// Based on claude-agent-sdk-rs types

export type CCMcpStdioConfig = {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  scope?: string;
};

export type CCMcpHttpConfig = {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  scope?: string;
};

export type CCMcpSseConfig = {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  scope?: string;
};

export type CCMcpServerConfig = CCMcpStdioConfig | CCMcpHttpConfig | CCMcpSseConfig;

export interface ClaudeCodeMcpServer {
  name: string;
  type: 'stdio' | 'http' | 'sse';
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  scope: 'global' | 'project' | 'local';
  enabled?: boolean;
}

export interface CCMcpServers {
  [serverName: string]: CCMcpServerConfig;
}

export type MCPConfigType = {
  mcpServers: CCMcpServers;
};
