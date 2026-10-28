window.__ModuleLoader__.load({
  id: 'harness-kanban',
  factory: require => {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const h = React.createElement;
    const PANEL = 'kanban';
    const STORAGE_KEY = 'harness-kanban.connection.v1';

    function normalizeOrigin(input) {
      if (typeof input !== 'string' || /[\\\u0000-\u0020]/.test(input.trim())) throw Error('请输入完整的 Kanban HTTPS 地址。');
      let url;
      try { url = new URL(input.trim()); } catch { throw Error('请输入完整的 Kanban HTTPS 地址。'); }
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw Error('局域网 Kanban 地址需要使用 HTTPS。');
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        throw Error('只填写服务地址和端口，不包含路径、账号、查询参数或登录凭据。');
      }
      return url.origin;
    }

    function embeddingIssue(url, environment) {
      if (!environment.secure) return '当前 Harness 使用非安全页面。请通过 HTTPS 入口打开 Harness，再连接 Kanban，以保留剪贴板、语音和编辑器能力。';
      if (url === environment.origin) return '该地址指向 Harness 本身，请填写现有 Kanban 的独立地址。';
      return '';
    }

    function createWorkspaceStore(storage) {
      let url = '';
      let warning = '';
      try {
        const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
        if (saved?.version === 1) url = normalizeOrigin(saved.url);
      } catch { /* Invalid or inaccessible local data does not prevent setup. */ }
      let snapshot = { url, warning, opened: false, active: false, expanded: false, generation: 0, bounds: null, loadState: 'idle' };
      const listeners = new Set();
      function update(patch) {
        if (Object.keys(patch).every(key => snapshot[key] === patch[key])) return;
        snapshot = { ...snapshot, ...patch };
        for (const listener of listeners) listener();
      }
      return {
        getSnapshot: () => snapshot,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        connect(value) {
          const next = normalizeOrigin(value);
          warning = '';
          try {
            if (!storage) throw Error('Storage unavailable');
            storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, url: next }));
          } catch { warning = '浏览器无法保存地址；本次仍可连接，下次打开需要重新填写。'; }
          update({ url: next, warning, ...(next !== snapshot.url ? { generation: snapshot.generation + 1, loadState: 'loading' } : {}) });
        },
        activate(active) {
          update({ active, opened: snapshot.opened || active,
            ...(active && snapshot.url && snapshot.loadState === 'idle' ? { loadState:'loading' } : {}) });
        },
        setExpanded(expanded) {
          update({ expanded, opened:snapshot.opened || expanded,
            ...(expanded && snapshot.url && snapshot.loadState === 'idle' ? { loadState:'loading' } : {}) });
        },
        setBounds(bounds) {
          if (bounds && snapshot.bounds && ['top', 'left', 'width', 'height'].every(key => bounds[key] === snapshot.bounds[key])) return;
          update({ bounds });
        },
        loaded() { update({ loadState: 'loaded' }); },
        failed() { update({ loadState: 'failed' }); },
        reload() { update({ generation: snapshot.generation + 1, loadState: 'loading' }); },
      };
    }

    const css = `
      .hkb { color:var(--dsw-alias-label-primary,#222); font-family:inherit; font-size:14px; line-height:1.5; box-sizing:border-box; }
      .hkb *, .hkb *::before, .hkb *::after { box-sizing:border-box; }
      .hkb[hidden] { display:none !important; }
      .hkb-workspace { position:fixed; display:flex; flex-direction:column; min-width:0; min-height:0; pointer-events:auto; background:var(--dsw-alias-bg-layer-1,#fff); z-index:10; overflow:hidden; }
      .hkb-workspace.hkb-expanded { z-index:100; border:1px solid var(--dsw-alias-border-l2,#ddd); border-radius:10px; }
      .hkb-launcher { position:fixed; top:12px; right:12px; z-index:90; pointer-events:auto; }
      .hkb-launcher button { display:flex; align-items:center; gap:6px; }
      .hkb-toolbar { display:flex; align-items:center; flex-wrap:wrap; gap:8px 12px; padding:8px 12px; min-height:44px; border-bottom:1px solid var(--dsw-alias-border-l2,#ddd); flex-shrink:0; }
      .hkb-toolbar strong { font-size:14px; font-weight:600; }
      .hkb-status { color:var(--dsw-alias-label-secondary,#62666d); font-size:12px; flex:1; min-width:80px; }
      .hkb button, .hkb .hkb-link { font:inherit; font-size:13px; color:inherit; background:var(--dsw-alias-bg-layer-2,#fff); border:1px solid var(--dsw-alias-border-l2,#d9dce1); border-radius:6px; padding:5px 10px; cursor:pointer; text-decoration:none; text-underline-offset:3px; }
      .hkb button:hover, .hkb .hkb-link:hover { background:var(--dsw-alias-bg-layer-3,#f3f4f6); }
      .hkb button:focus-visible, .hkb a:focus-visible, .hkb input:focus-visible { outline:2px solid var(--dsw-alias-brand-primary,#3769de); outline-offset:3px; }
      .hkb .hkb-primary { background:var(--dsw-alias-brand-primary,#3769de); color:white; border-color:transparent; }
      .hkb .hkb-primary:hover { filter:brightness(.95); }
      .hkb-form { padding:24px; max-width:680px; width:100%; margin:auto; }
      .hkb-settings { overflow:auto; }
      .hkb-settings .hkb-form { margin:0; padding:20px 16px; }
      .hkb h1, .hkb h2 { font-size:20px; font-weight:600; line-height:1.35; margin:0 0 12px; }
      .hkb p { margin:8px 0 16px; max-width:72ch; }
      .hkb .hkb-muted { color:var(--dsw-alias-label-secondary,#62666d); font-size:13px; }
      .hkb label { display:block; font-size:13px; font-weight:500; margin:20px 0 8px; }
      .hkb input { width:100%; font:inherit; color:inherit; background:var(--dsw-alias-bg-layer-2,#fff); border:1px solid var(--dsw-alias-border-l2,#d9dce1); border-radius:6px; padding:10px 12px; caret-color:var(--dsw-alias-brand-primary,#3769de); }
      .hkb input::placeholder { color:var(--dsw-alias-label-secondary,#62666d); opacity:1; }
      .hkb-actions { display:flex; align-items:center; gap:10px; margin-top:16px; flex-wrap:wrap; }
      .hkb-notice { padding:12px 16px; background:var(--dsw-alias-bg-layer-3,#f3f4f6); border-bottom:1px solid var(--dsw-alias-border-l2,#ddd); font-size:13px; flex-shrink:0; }
      .hkb-error { font-size:13px; margin-top:12px; }
      .hkb-frame { display:block; width:100%; flex:1; min-height:0; border:0; background:var(--dsw-alias-bg-layer-1,#fff); }
      .hkb-frame[hidden] { display:none; }
      .hkb ::selection { background:var(--dsw-alias-brand-primary,#3769de); color:white; }
      @media(max-width:600px) { .hkb-toolbar { padding:8px; } .hkb-form { padding:20px 16px; } .hkb button,.hkb .hkb-link { min-height:36px; } }
    `;

    function Icon() {
      return h('svg', { width:18, height:18, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', strokeWidth:1.7, 'aria-hidden':true },
        h('rect', { x:3, y:4, width:18, height:16, rx:2 }), h('path', { d:'M9 4v16M15 4v16M5.5 8H7M11.5 8H13M17.5 8H19', strokeLinecap:'round' }));
    }

    function apply(ctx) {
      let storage;
      try { storage = window.localStorage; } catch { /* Browser policy may disable storage. */ }
      const store = createWorkspaceStore(storage);
      const useWorkspace = () => React.useSyncExternalStore(store.subscribe, store.getSnapshot);

      function ConnectionForm({ onDone, compact = false }) {
        const state = useWorkspace();
        const [value, setValue] = React.useState(state.url);
        const [error, setError] = React.useState('');
        const inputId = React.useId();
        const errorId = `${inputId}-error`;
        function submit(event) {
          event.preventDefault();
          event.stopPropagation();
          try {
            const url = normalizeOrigin(value);
            if (url === window.location.origin) throw Error('该地址指向 Harness 本身，请填写 Kanban 地址。');
            store.connect(url);
            setError('');
            onDone?.();
          } catch (failure) { setError(failure.message); }
        }
        return h('form', { className:'hkb-form', onSubmit:submit },
          h(compact ? 'h2' : 'h1', null, state.url ? 'Kanban 连接' : '连接现有 Kanban'),
          h('p', { className:'hkb-muted' }, '在 Harness 中使用现有看板的完整工作台，继续使用同一服务、项目和会话。'),
          h('label', { htmlFor:inputId }, 'Kanban 服务地址'),
          h('input', { id:inputId, type:'url', required:true, value, placeholder:'https://你的看板地址:端口', spellCheck:false, autoComplete:'off', 'aria-invalid':Boolean(error), 'aria-describedby':error ? errorId : undefined, onChange:event => setValue(event.target.value) }),
          h('p', { className:'hkb-muted' }, '填写原来打开看板的 HTTPS 地址，仅保存于当前浏览器。登录链接和凭据请勿填写。'),
          error ? h('p', { id:errorId, role:'alert', className:'hkb-error' }, error) : null,
          state.warning ? h('p', { role:'status', className:'hkb-error' }, state.warning) : null,
          h('div', { className:'hkb-actions' }, h('button', { type:'submit', className:'hkb-primary' }, '保存并连接'),
            onDone && state.url ? h('button', { type:'button', onClick:onDone }, '取消') : null),
          h('p', { className:'hkb-muted' }, '连接不会启动新看板、导入历史或停止后台任务。'));
      }

      function MainAnchor() {
        const ref = React.useRef(null);
        React.useLayoutEffect(() => {
          const element = ref.current;
          const measure = () => {
            const rect = element.getBoundingClientRect();
            store.setBounds({ top:rect.top, left:rect.left, width:rect.width, height:rect.height });
          };
          const observer = new ResizeObserver(measure);
          observer.observe(element);
          window.addEventListener('resize', measure);
          window.addEventListener('scroll', measure, true);
          measure();
          return () => {
            observer.disconnect();
            window.removeEventListener('resize', measure);
            window.removeEventListener('scroll', measure, true);
            store.setBounds(null);
          };
        }, []);
        return h('div', { ref, 'data-harness-kanban-anchor':'', style:{ height:'100%', width:'100%', minHeight:0 } });
      }

      function Workspace({ usePanelInfo }) {
        const selected = usePanelInfo(info => info.activePanelId === PANEL);
        const state = useWorkspace();
        const [editing, setEditing] = React.useState(false);
        const [slow, setSlow] = React.useState(false);
        const [viewport, setViewport] = React.useState({ width:window.innerWidth, height:window.innerHeight });
        const frame = React.useRef(null);
        const workspace = React.useRef(null);
        const launcher = React.useRef(null);
        const closeButton = React.useRef(null);
        const returnFocus = React.useRef(false);
        const issue = state.url ? embeddingIssue(state.url, { origin:window.location.origin, secure:window.isSecureContext }) : '';
        const anchored = selected && state.bounds?.width > 0 && state.bounds?.height > 0 && !state.expanded;
        const visible = Boolean(state.expanded || anchored);
        const close = () => {
          returnFocus.current = true;
          store.setExpanded(false);
          if (selected) ctx.layout.selectPanel(null);
        };
        React.useEffect(() => {
          const resize = () => setViewport({ width:window.innerWidth, height:window.innerHeight });
          window.addEventListener('resize', resize);
          return () => window.removeEventListener('resize', resize);
        }, []);
        React.useEffect(() => { store.activate(selected); }, [selected]);
        React.useEffect(() => {
          if (visible) closeButton.current?.focus({ preventScroll:true });
          else {
            if (workspace.current?.contains(document.activeElement)) document.activeElement?.blur();
            if (returnFocus.current) {
              launcher.current?.focus({ preventScroll:true });
              returnFocus.current = false;
            }
          }
        }, [visible]);
        React.useEffect(() => {
          setSlow(false);
          if (!state.opened || !state.url || issue || state.loadState !== 'loading') return;
          const timer = setTimeout(() => setSlow(true), 15000);
          return () => clearTimeout(timer);
        }, [state.opened, state.url, state.generation, state.loadState, issue]);
        const canMount = state.opened && state.url && !issue;
        const bounds = anchored ? state.bounds : { top:12, left:12, width:viewport.width - 24, height:viewport.height - 24 };
        const status = !state.url ? '尚未连接' : issue ? '需要安全入口' : state.loadState === 'loaded' ? '使用现有看板' : state.loadState === 'failed' ? '页面加载失败' : '正在打开…';
        return createPortal(h(React.Fragment, null, h('style', null, css),
          h('div', { className:'hkb hkb-launcher', hidden:visible },
            h('button', { ref:launcher, type:'button', onClick:() => store.setExpanded(true), 'aria-label':'打开 Kanban' }, h(Icon), 'Kanban')),
          h('section', { ref:workspace, className:`hkb hkb-workspace${anchored ? '' : ' hkb-expanded'}`, hidden:!visible, inert:visible ? undefined : '', style:bounds, 'aria-label':'Kanban 工作台' },
            h('header', { className:'hkb-toolbar' }, h('button', { ref:closeButton, type:'button', onClick:close }, '返回 Harness'), h('strong', null, 'Kanban'), h('span', { className:'hkb-status', role:'status' }, status),
              state.url ? h('a', { className:'hkb-link', href:`${state.url}/`, target:'_blank', rel:'noopener noreferrer' }, '独立打开') : null,
              state.url ? h('button', { type:'button', onClick:() => setEditing(!editing), 'aria-expanded':editing }, editing ? '返回看板' : '连接设置') : null),
            issue ? h('div', { className:'hkb-notice', role:'status' }, issue) : null,
            (slow || state.loadState === 'failed') && !issue ? h('div', { className:'hkb-notice', role:'status' },
              '如果页面仍空白，请先独立打开，确认地址与证书。重载页面不会停止后台任务。 ',
              h('button', { type:'button', onClick:() => store.reload() }, '重载页面')) : null,
            !state.url || editing ? h('div', { className:'hkb-settings' }, h(ConnectionForm, { onDone:() => setEditing(false) })) : null,
            canMount ? h('iframe', { ref:frame, key:state.generation, className:'hkb-frame', hidden:editing,
              src:`${state.url}/`, title:'Coding Kanban', allow:'clipboard-read; clipboard-write; microphone; fullscreen', allowFullScreen:true,
              onLoad:() => store.loaded(), onError:() => store.failed() }) : null)), document.body);
      }

      function Settings() {
        return h('div', { className:'hkb hkb-settings' }, h('style', null, css), h(ConnectionForm, { compact:true }));
      }

      ctx.inject(['slots', 'layout'], scope => {
        scope.slots.inject('main', () => scope.slots.register({ name:'main', key:PANEL }, MainAnchor));
        scope.slots.inject('sidebar.panellist', () => scope.slots.register({ name:'sidebar.panellist', id:PANEL, label:'Kanban', order:22 }, Icon));
        scope.slots.inject('shell.overlay', () => scope.slots.register({ name:'shell.overlay', id:'harness-kanban.workspace', order:10 }, Workspace));
        scope.slots.inject('settings.plugins.tab', () => scope.slots.register({ name:'settings.plugins.tab', id:'harness-kanban', label:'Kanban', order:33 }, Settings));
      });
    }

    return { apply, inject:[], normalizeOrigin, createWorkspaceStore, embeddingIssue };
  },
});
