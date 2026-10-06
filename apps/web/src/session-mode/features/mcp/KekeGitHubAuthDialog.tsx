import { useState } from 'react';
import { Button } from '@session/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@session/components/ui/dialog';
import { Input } from '@session/components/ui/input';
import { Label } from '@session/components/ui/label';
import { useExternalUrl } from '@session/features/plugins/hooks/useExternalUrl';
import type { useKekeMcpAuth } from './useKekeMcpAuth';

export function KekeGitHubAuthDialog({
  auth,
  onAuthorized,
}: {
  auth: ReturnType<typeof useKekeMcpAuth>;
  onAuthorized?: () => void;
}) {
  const [token, setToken] = useState('');
  const { openExternalUrl } = useExternalUrl();
  const name = auth.githubName;
  const busy = name !== null && auth.pending === name;
  return (
    <Dialog
      open={name !== null}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setToken('');
          auth.dismissGitHub();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Authorize GitHub</DialogTitle>
          <DialogDescription>Connect with a personal access token.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={async (event) => {
            event.preventDefault();
            if (await auth.authorizeGitHub(token)) {
              setToken('');
              onAuthorized?.();
            }
          }}
        >
          <Label htmlFor="github-mcp-token">GitHub token</Label>
          <Input
            id="github-mcp-token"
            type="password"
            autoComplete="off"
            value={token}
            disabled={busy}
            onChange={(event) => setToken(event.target.value)}
          />
          <Button
            type="button"
            variant="link"
            className="self-start px-0"
            onClick={() =>
              openExternalUrl('https://github.com/settings/personal-access-tokens/new')
            }
          >
            Create a token
          </Button>
          {name && auth.errors[name] && (
            <p role="alert" className="text-sm text-destructive">
              {auth.errors[name]}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={busy || !token.trim()}>
              {busy ? 'Authorizing…' : 'Authorize'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
