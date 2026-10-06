import { Input } from '@session/components/ui/input';
import { Label } from '@session/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@session/components/ui/select';
import { Textarea } from '@session/components/ui/textarea';

type ServerType = 'stdio' | 'http' | 'sse';

interface McpServerFormFieldsProps {
  serverType: ServerType;
  name: string;
  onNameChange: (value: string) => void;
  command: string;
  onCommandChange: (value: string) => void;
  args: string;
  onArgsChange: (value: string) => void;
  url: string;
  onUrlChange: (value: string) => void;
  env: string;
  onEnvChange: (value: string) => void;
  onTypeChange: (value: ServerType) => void;
  namePlaceholder?: string;
  envLabel?: string;
}

export function McpServerFormFields({
  serverType,
  name,
  onNameChange,
  command,
  onCommandChange,
  args,
  onArgsChange,
  url,
  onUrlChange,
  env,
  onEnvChange,
  onTypeChange,
  namePlaceholder = 'my-mcp-server',
  envLabel = 'Environment Variables (JSON, optional)',
}: McpServerFormFieldsProps) {
  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs">Server Name</Label>
        <Input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={namePlaceholder}
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Type</Label>
        <Select value={serverType} onValueChange={(v) => onTypeChange(v as ServerType)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stdio">Stdio</SelectItem>
            <SelectItem value="http">HTTP</SelectItem>
            <SelectItem value="sse">SSE</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {serverType === 'stdio' ? (
        <>
          <div className="space-y-2">
            <Label className="text-xs">Command</Label>
            <Input
              value={command}
              onChange={(e) => onCommandChange(e.target.value)}
              placeholder="node"
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Arguments (space-separated)</Label>
            <Input
              value={args}
              onChange={(e) => onArgsChange(e.target.value)}
              placeholder="server.js --port 3000"
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">{envLabel}</Label>
            <Textarea
              value={env}
              onChange={(e) => onEnvChange(e.target.value)}
              placeholder='{"API_KEY": "your-key", "PORT": "3000"}'
              className="text-xs font-mono"
              rows={3}
            />
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label className="text-xs">URL</Label>
          <Input
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="http://localhost:3000"
            className="h-8 text-xs"
          />
        </div>
      )}
    </>
  );
}
