import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(resolve(root,'apps/web/package.json'));
test('cold tooltip and separator graph does not load the unrelated Radix primitive catalog',async()=>{
 const {build}=createRequire(require.resolve('vite/package.json'))('esbuild');
 const result=await build({entryPoints:[resolve(root,'apps/web/src/session-mode/components/ui/tooltip.tsx'),resolve(root,'apps/web/src/session-mode/components/ui/separator.tsx')],outdir:'out',bundle:true,write:false,metafile:true,treeShaking:false,format:'esm',external:['react','react-dom'],alias:{'@session':resolve(root,'apps/web/src/session-mode')},logLevel:'silent'});
 const meta=Object.keys(result.metafile.inputs).filter(path=>path.includes('/node_modules/radix-ui/'));
 assert.deepEqual(meta,[],'default-closed primitives must not bring the full Radix catalog into the dev module graph');
});
test('direct primitives share the original provider/context and root component identity',()=>{
 const meta=require('radix-ui'),tooltip=require('@radix-ui/react-tooltip'),separator=require('@radix-ui/react-separator');
 for(const key of ['Provider','Root','Trigger','Portal','Content'])assert.equal(tooltip[key],meta.Tooltip[key],`Tooltip.${key}`);
 const {createElement}=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 for(const props of [{},{orientation:'vertical',decorative:false},{orientation:'horizontal',decorative:true,className:'example','data-test':'separator'}])assert.equal(renderToStaticMarkup(createElement(separator.Root,props)),renderToStaticMarkup(createElement(meta.Separator.Root,props)));
});
test('the cold button, popover, sheet and sidebar graph avoids the aggregate Radix catalog',async()=>{
 const {build}=createRequire(require.resolve('vite/package.json'))('esbuild');
 const result=await build({entryPoints:['button','popover','sheet','sidebar'].map(name=>resolve(root,`apps/web/src/session-mode/components/ui/${name}.tsx`)),outdir:'out',bundle:true,write:false,metafile:true,treeShaking:false,format:'esm',external:['react','react-dom','lucide-react'],alias:{'@session':resolve(root,'apps/web/src/session-mode')},logLevel:'silent'});
 assert.deepEqual(Object.keys(result.metafile.inputs).filter(path=>path.includes('/node_modules/radix-ui/')),[], 'initial input/layout primitives must not import the aggregate Radix package');
});
test('direct popover and sheet retain exact original context, focus and portal primitives',()=>{
 const meta=require('radix-ui');
 for(const [name,pkg,keys] of [['Popover','@radix-ui/react-popover',['Root','Anchor','Trigger','Portal','Content']],['Dialog','@radix-ui/react-dialog',['Root','Trigger','Portal','Overlay','Content','Title','Description','Close']]]){
  const direct=require(pkg);
  for(const key of keys)assert.equal(direct[key],meta[name][key],`${name}.${key}`);
 }
});
