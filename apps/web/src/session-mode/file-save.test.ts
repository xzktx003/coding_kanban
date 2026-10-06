import { expect, it, vi } from 'vitest';
import { saveFileWithConflictCheck } from './file-save';
it('keeps the file untouched when an external edit is not approved', async () => {
 const write = vi.fn(); const confirm = vi.fn(() => false);
 await expect(saveFileWithConflictCheck('/file', 'original', 'my draft', async () => 'external edit', write, confirm)).rejects.toThrow('未覆盖');
 expect(confirm).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
});
it('saves unchanged disk content without prompting', async () => {
 const write = vi.fn(); const confirm = vi.fn();
 await saveFileWithConflictCheck('/file', 'original', 'my draft', async () => 'original', write, confirm);
 expect(write).toHaveBeenCalledWith('/file', 'my draft'); expect(confirm).not.toHaveBeenCalled();
});
