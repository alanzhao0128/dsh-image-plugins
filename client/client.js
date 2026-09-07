// dsh-image-plugins — browser half.
//
// A settings panel (settings.section slot) for the image plugin: edits the
// dsh-image-plugins namespace (vision / image endpoint blocks) through
// ctx.settingsScope, and manages the two capability secrets through the
// official credential seam (UNDERSTAND_IMAGE_KEY / GENERATE_IMAGE_KEY) — the
// panel never displays a stored secret; it only reports configured/unconfigured
// state and lets the user type a new value, which the host writes via
// credentials.set into ~/.dsh/.credentials.yaml.
//
// Hand-written classic-script bundle: the module table answers require() for
// the platform entries (react, react/jsx-runtime); everything else is inlined
// here. No build step, no CSS files — inline styles only, using the
// design-system variables so the panel follows the active theme.

window.__ModuleLoader__.load({
  id: 'dsh-image-plugins',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const { jsx, jsxs } = require('react/jsx-runtime');
    const { useCallback, useEffect, useState } = require('react');

    const NS = 'image-plugin';
    const SETTINGS_NS = 'dsh-image-plugins';
    const UNDERSTAND_IMAGE_REF = 'UNDERSTAND_IMAGE_KEY';
    const GENERATE_IMAGE_REF = 'GENERATE_IMAGE_KEY';

    const zh = {
      'settings.title': '图片插件',
      'settings.intro': '配置图片理解与图像生成的端点。凭据通过官方凭据服务写入 ~/.dsh/.credentials.yaml，界面不会显示已保存的密钥。改动保存后即时生效。',
      'settings.group.vision': '视觉理解',
      'settings.group.image': '图像生成',
      'settings.vision.baseUrl': '端点地址',
      'settings.vision.baseUrlHint': 'OpenAI 兼容 chat/completions 端点，如 https://api.deepseek.com',
      'settings.vision.model': '模型',
      'settings.vision.modelHint': '支持图片输入的模型，如 deepseek-v4-flash-vision-exp',
      'settings.vision.timeoutMs': '超时（秒）',
      'settings.vision.timeoutMsHint': '默认 60 秒',
      'settings.vision.maxImageBytes': '图片大小上限（字节）',
      'settings.vision.maxImageBytesHint': '默认 20 MiB (20971520)',
      'settings.vision.systemPrompt': '系统提示词（可选）',
      'settings.vision.systemPromptHint': '发送给视觉模型的额外系统提示',
      'settings.vision.defaultPrompt': '默认指令（可选）',
      'settings.vision.defaultPromptHint': '模型未给指令时使用的默认描述指令',
      'settings.image.provider': '提供方',
      'settings.image.providerHint': 'openai（OpenAI 兼容）或 dashscope（百炼原生）',
      'settings.image.baseUrl': '端点地址',
      'settings.image.baseUrlHint': 'openai: 如 https://api.example.com/v1；dashscope: 百炼兼容模式地址（自动归一化）',
      'settings.image.model': '模型',
      'settings.image.modelHint': '如 qwen-image-3.0-pro',
      'settings.image.defaultSize': '默认尺寸',
      'settings.image.defaultSizeHint': '如 1024x1024',
      'settings.image.outputDir': '输出目录',
      'settings.image.outputDirHint': '工作区内相对目录，默认 generated',
      'settings.image.timeoutMs': '超时（秒）',
      'settings.image.timeoutMsHint': '默认 120 秒',
      'settings.image.maxReferenceBytes': '图生图参考图上限（字节）',
      'settings.image.maxReferenceBytesHint': '默认 10 MiB (10485760)',
      'settings.cred.sectionLabel': '凭据',
      'settings.cred.intro': '粘贴新的 API Key 保存后，通过官方凭据服务写入凭据仓库；界面永不回显已存密钥。',
      'settings.cred.understand': '视觉理解 Key',
      'settings.cred.understandHint': 'UNDERSTAND_IMAGE_KEY — understand_image 工具使用',
      'settings.cred.generate': '图像生成 Key',
      'settings.cred.generateHint': 'GENERATE_IMAGE_KEY — generate_image 工具使用',
      'settings.cred.configured': '已配置',
      'settings.cred.missing': '未配置',
      'settings.cred.save': '保存',
      'settings.cred.saved': '已保存',
      'settings.cred.failed': '保存失败',
      'settings.save': '保存设置',
      'settings.saving': '保存中…',
      'settings.discard': '放弃修改',
      'settings.saved': '已保存',
      'settings.failed': '保存失败',
      'settings.readonly': '设置文档不可写（只读环境）。',
    };

    const en = {
      'settings.title': 'Image Plugins',
      'settings.intro': 'Configure the image-understanding and image-generation endpoints. Secrets are written to ~/.dsh/.credentials.yaml through the official credential service; the UI never shows a stored key. Changes apply immediately after saving.',
      'settings.group.vision': 'Image Understanding',
      'settings.group.image': 'Image Generation',
      'settings.vision.baseUrl': 'Base URL',
      'settings.vision.baseUrlHint': 'OpenAI-compatible chat/completions endpoint, e.g. https://api.deepseek.com',
      'settings.vision.model': 'Model',
      'settings.vision.modelHint': 'An image-capable model, e.g. deepseek-v4-flash-vision-exp',
      'settings.vision.timeoutMs': 'Timeout (s)',
      'settings.vision.timeoutMsHint': 'Default 60 s',
      'settings.vision.maxImageBytes': 'Max image bytes',
      'settings.vision.maxImageBytesHint': 'Default 20 MiB (20971520)',
      'settings.vision.systemPrompt': 'System prompt (optional)',
      'settings.vision.systemPromptHint': 'Extra system prompt sent to the vision model',
      'settings.vision.defaultPrompt': 'Default instruction (optional)',
      'settings.vision.defaultPromptHint': 'Instruction used when the model gives none',
      'settings.image.provider': 'Provider',
      'settings.image.providerHint': 'openai (OpenAI-compatible) or dashscope (native)',
      'settings.image.baseUrl': 'Base URL',
      'settings.image.baseUrlHint': 'openai: e.g. https://api.example.com/v1; dashscope: compatible-mode URL (normalized)',
      'settings.image.model': 'Model',
      'settings.image.modelHint': 'e.g. qwen-image-3.0-pro',
      'settings.image.defaultSize': 'Default size',
      'settings.image.defaultSizeHint': 'e.g. 1024x1024',
      'settings.image.outputDir': 'Output directory',
      'settings.image.outputDirHint': 'Workspace-relative, default generated',
      'settings.image.timeoutMs': 'Timeout (s)',
      'settings.image.timeoutMsHint': 'Default 120 s',
      'settings.image.maxReferenceBytes': 'Max reference bytes',
      'settings.image.maxReferenceBytesHint': 'Default 10 MiB (10485760)',
      'settings.cred.sectionLabel': 'Credentials',
      'settings.cred.intro': 'Pasting a new API key here writes it to the credential store through the official credential service; the UI never echoes a stored secret.',
      'settings.cred.understand': 'Understanding Key',
      'settings.cred.understandHint': 'UNDERSTAND_IMAGE_KEY — used by understand_image',
      'settings.cred.generate': 'Generation Key',
      'settings.cred.generateHint': 'GENERATE_IMAGE_KEY — used by generate_image',
      'settings.cred.configured': 'Configured',
      'settings.cred.missing': 'Not configured',
      'settings.cred.save': 'Save',
      'settings.cred.saved': 'Saved',
      'settings.cred.failed': 'Save failed',
      'settings.save': 'Save settings',
      'settings.saving': 'Saving…',
      'settings.discard': 'Discard',
      'settings.saved': 'Saved',
      'settings.failed': 'Save failed',
      'settings.readonly': 'Settings document is not writable (read-only environment).',
    };

    /** Settings namespace defaults — must mirror lib/config.js DEFAULTS. */
    const DEFAULTS = {
      'vision.baseUrl': '',
      'vision.apiKey': 'cred:UNDERSTAND_IMAGE_KEY',
      'vision.model': '',
      'vision.timeoutMs': 60000,
      'vision.maxImageBytes': 20971520,
      'vision.systemPrompt': '',
      'vision.defaultPrompt': '',
      'image.baseUrl': '',
      'image.apiKey': 'cred:GENERATE_IMAGE_KEY',
      'image.model': '',
      'image.provider': 'openai',
      'image.timeoutMs': 120000,
      'image.defaultSize': '1024x1024',
      'image.outputDir': 'generated',
      'image.maxReferenceBytes': 10485760,
      'autoUnderstand': false,
    };

    /** Read one dotted path from a settings snapshot value. */
    const readPath = (value, path) => {
      let node = value;
      for (const key of path) {
        if (node === null || node === undefined || typeof node !== 'object') return undefined;
        node = node[key];
      }
      return node;
    };

    /** A settings-scope-backed value reader: snapshot → value with defaults. */
    const makeScopeReader = (scope, DEFAULTS) => {
      const get = (path) => {
        if (!scope) return DEFAULTS[path.join('.')];
        const snap = scope.getSnapshot();
        const value = snap && snap.status === 'ready' ? snap.value : undefined;
        const stored = readPath(value, path);
        return stored !== undefined ? stored : DEFAULTS[path.join('.')];
      };
      return get;
    };

    const inject = ['connection', 'slots', 'locale', 'settingsScope', 'remote', 'remote.credentials'];

    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, { zh, en }),
        'image-plugins: dictionaries',
      );

      const connection = ctx.get('connection');
      const remote = ctx.get('remote');
      let scope = null;
      try { scope = ctx.get('settingsScope').bind({ namespace: SETTINGS_NS }); } catch { /* absent */ }
      const cfg = makeScopeReader(scope, DEFAULTS);

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        {
          name: 'settings.section',
          id: 'image-plugins',
          order: 90,
          label: () => (ctx.locale.getLocale().active === 'zh' ? '图片插件' : 'Image Plugins'),
          locale: NS,
          inject: () => ({ connection, scope, remote }),
        },
        SettingsPage,
      ));
    }

    /** One field spec of the settings form. */
    const FIELDS = [
      // ---- 视觉理解 ----
      { path: ['vision', 'baseUrl'], type: 'text', group: 'vision', labelKey: 'settings.vision.baseUrl', hintKey: 'settings.vision.baseUrlHint' },
      { path: ['vision', 'model'], type: 'text', group: 'vision', labelKey: 'settings.vision.model', hintKey: 'settings.vision.modelHint' },
      { path: ['vision', 'timeoutMs'], type: 'secMs', group: 'vision', labelKey: 'settings.vision.timeoutMs', hintKey: 'settings.vision.timeoutMsHint' },
      { path: ['vision', 'maxImageBytes'], type: 'number', group: 'vision', labelKey: 'settings.vision.maxImageBytes', hintKey: 'settings.vision.maxImageBytesHint' },
      { path: ['vision', 'systemPrompt'], type: 'text', group: 'vision', labelKey: 'settings.vision.systemPrompt', hintKey: 'settings.vision.systemPromptHint' },
      { path: ['vision', 'defaultPrompt'], type: 'text', group: 'vision', labelKey: 'settings.vision.defaultPrompt', hintKey: 'settings.vision.defaultPromptHint' },
      // ---- 图像生成 ----
      { path: ['image', 'provider'], type: 'select', group: 'image', labelKey: 'settings.image.provider', hintKey: 'settings.image.providerHint', options: ['openai', 'dashscope'] },
      { path: ['image', 'baseUrl'], type: 'text', group: 'image', labelKey: 'settings.image.baseUrl', hintKey: 'settings.image.baseUrlHint' },
      { path: ['image', 'model'], type: 'text', group: 'image', labelKey: 'settings.image.model', hintKey: 'settings.image.modelHint' },
      { path: ['image', 'defaultSize'], type: 'text', group: 'image', labelKey: 'settings.image.defaultSize', hintKey: 'settings.image.defaultSizeHint' },
      { path: ['image', 'outputDir'], type: 'text', group: 'image', labelKey: 'settings.image.outputDir', hintKey: 'settings.image.outputDirHint' },
      { path: ['image', 'timeoutMs'], type: 'secMs', group: 'image', labelKey: 'settings.image.timeoutMs', hintKey: 'settings.image.timeoutMsHint' },
      { path: ['image', 'maxReferenceBytes'], type: 'number', group: 'image', labelKey: 'settings.image.maxReferenceBytes', hintKey: 'settings.image.maxReferenceBytesHint' },
    ];

    const GROUPS = [
      { id: 'vision', labelKey: 'settings.group.vision' },
      { id: 'image', labelKey: 'settings.group.image' },
    ];

    const pathKey = (path) => path.join('.');

    /**
     * Settings page (settings.section slot): edits the dsh-image-plugins
     * namespace through ctx.settingsScope — staged drafts + Save/Discard —
     * plus a credentials section that writes secrets through the official
     * credential seam.
     */
    function SettingsPage({ t, connection, scope, remote }) {
      const dict = zh;
      const tr = (key) => (t ? t(key) : dict[key]);
      const [draft, setDraft] = useState({});
      const [saving, setSaving] = useState(false);
      const [saved, setSaved] = useState(false);
      const [failed, setFailed] = useState(false);
      const [credStatus, setCredStatus] = useState(null); // { credentials: { ref: {configured, writable} } }
      const [credDrafts, setCredDrafts] = useState({}); // ref -> typed value
      const [credSaving, setCredSaving] = useState(null); // ref currently saving
      const [credSaved, setCredSaved] = useState({}); // ref -> true after save
      const [credFailed, setCredFailed] = useState({}); // ref -> true on failure
      const [, force] = useState(0);

      useEffect(() => {
        if (!scope) return undefined;
        return scope.subscribe(() => force((n) => n + 1));
      }, [scope]);

      // Fetch credential status (configured/writable) — never the value.
      useEffect(() => {
        let alive = true;
        (async () => {
          try {
            const result = await connection.rpc.call('/image-plugin-status', 'snapshot', {});
            if (alive && result && result.ok && result.value) setCredStatus(result.value);
          } catch {
            if (alive) setCredStatus(null);
          }
        })();
        return () => { alive = false; };
      }, [connection]);

      const snapshot = scope ? scope.getSnapshot() : null;
      const value = snapshot && snapshot.status === 'ready' ? snapshot.value : undefined;
      const writable = snapshot ? snapshot.writable : false;

      const setField = (key, val) => {
        setDraft((d) => ({ ...d, [key]: val }));
        setSaved(false);
        setFailed(false);
      };

      const fieldValue = (spec) => {
        const key = pathKey(spec.path);
        if (draft[key] !== undefined) return draft[key];
        let stored = readPath(value, spec.path);
        if (stored === undefined) stored = DEFAULTS[key];
        // Seconds-unit fields display in seconds (the document stores ms).
        if (spec.type === 'secMs' && typeof stored === 'number') return stored / 1000;
        return stored;
      };

      const save = async () => {
        if (!scope || Object.keys(draft).length === 0) return;
        setSaving(true);
        setFailed(false);
        try {
          const ops = Object.entries(draft).map(([key, val]) => {
            const path = key.split('.');
            const spec = FIELDS.find((f) => pathKey(f.path) === key);
            if (spec && (spec.type === 'number' || spec.type === 'secMs')) {
              if (val === '' || val === null || val === undefined) {
                return { op: 'unset', path };
              }
              const n = Number(val);
              if (!Number.isFinite(n)) return null;
              // Seconds-unit fields store milliseconds in the document.
              return { op: 'set', path, value: spec.type === 'secMs' ? Math.round(n * 1000) : n };
            }
            if (spec && spec.type === 'text' && (val === '' || val === null || val === undefined)) {
              return { op: 'unset', path };
            }
            return { op: 'set', path, value: val };
          }).filter(Boolean);
          if (ops.length === 0) { setSaving(false); return; }
          const revision = scope.getSnapshot().revision;
          await scope.mutate(ops, revision);
          setDraft({});
          setSaved(true);
        } catch {
          setFailed(true);
        } finally {
          setSaving(false);
        }
      };

      /** Save one credential ref through the official credentials seam. */
      const saveCredential = async (ref) => {
        const val = credDrafts[ref];
        if (!val) return;
        setCredSaving(ref);
        setCredFailed((f) => ({ ...f, [ref]: false }));
        setCredSaved((s) => ({ ...s, [ref]: false }));
        try {
          const response = await remote.credentials.set(ref, val);
          if (!response.ok) {
            setCredFailed((f) => ({ ...f, [ref]: true }));
          } else {
            setCredDrafts((d) => ({ ...d, [ref]: '' }));
            setCredSaved((s) => ({ ...s, [ref]: true }));
            setCredStatus((st) => {
              if (!st) return st;
              const credentials = { ...st.credentials, [ref]: { ...(st.credentials[ref] || {}), configured: true } };
              return { ...st, credentials };
            });
          }
        } catch {
          setCredFailed((f) => ({ ...f, [ref]: true }));
        } finally {
          setCredSaving(null);
        }
      };

      const discard = () => {
        setDraft({});
        setSaved(false);
        setFailed(false);
      };

      // ---- render ----
      // Each capability group carries its own credential row (endpoint, model,
      // and key belong together), so a group renders its fields + its key row.
      const CRED_ROW_BY_GROUP = {
        vision: { labelKey: 'settings.cred.understand', ref: UNDERSTAND_IMAGE_REF, hintKey: 'settings.cred.understandHint' },
        image: { labelKey: 'settings.cred.generate', ref: GENERATE_IMAGE_REF, hintKey: 'settings.cred.generateHint' },
      };
      const renderGroup = (group) => {
        const fields = FIELDS.filter((f) => f.group === group.id);
        if (fields.length === 0) return null;
        const children = fields.map((spec) => jsx(FieldRow, {
          key: pathKey(spec.path),
          spec,
          t: tr,
          value: fieldValue(spec),
          onChange: setField,
        }));
        const credSpec = CRED_ROW_BY_GROUP[group.id];
        return jsx('div', { key: group.id, style: { marginBottom: 20 }, children: [
          jsx('div', { style: { fontSize: 13, fontWeight: 600, lineHeight: '20px', color: 'var(--dsw-alias-label-primary)', margin: '0 0 10px' }, children: tr(group.labelKey) }),
          ...children,
          credSpec ? jsxs('div', { style: { borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 10, marginTop: 12 }, children: [
            jsx('div', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', margin: '0 0 8px' }, children: tr('settings.cred.sectionLabel') }),
            jsx('div', { style: { fontSize: 11, lineHeight: '16px', color: 'var(--dsw-alias-label-tertiary)', margin: '0 0 8px' }, children: tr('settings.cred.intro') }),
            credRow(credSpec.labelKey, credSpec.ref, credSpec.hintKey),
          ]}) : null,
        ]});
      };

      // ---- Credentials section ----
      const credView = (ref) => (credStatus && credStatus.credentials ? credStatus.credentials[ref] : null);
      const statusText = (ref) => {
        const view = credView(ref);
        if (!view) return tr('settings.cred.missing');
        return view.configured ? tr('settings.cred.configured') : tr('settings.cred.missing');
      };
      const statusColor = (ref) => {
        const view = credView(ref);
        return view && view.configured
          ? 'var(--dsw-alias-state-success-primary)'
          : 'var(--dsw-alias-state-warning-primary, #d29922)';
      };
      // One writable password row: label + status badge + input + save button + feedback.
      const credRow = (labelKey, ref, hintKey) => {
        const draftVal = credDrafts[ref] || '';
        const busy = credSaving === ref;
        const done = credSaved[ref] === true;
        const err = credFailed[ref] === true;
        return jsxs('div', {
          key: ref,
          style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
          children: [
            jsx('span', { style: { fontSize: 12.5, color: 'var(--dsw-alias-label-primary)', minWidth: 130 }, children: tr(labelKey) }),
            jsx('span', { style: { fontSize: 11.5, color: statusColor(ref), fontWeight: 500 }, children: statusText(ref) }),
            jsx('input', {
              type: 'password',
              value: draftVal,
              placeholder: ref,
              onChange: (e) => {
                setCredDrafts((d) => ({ ...d, [ref]: e.target.value }));
                setCredSaved((s) => ({ ...s, [ref]: false }));
                setCredFailed((f) => ({ ...f, [ref]: false }));
              },
              style: { flex: 1, minWidth: 160, maxWidth: 260, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', fontSize: 12.5, fontFamily: 'ui-monospace, Menlo, monospace' },
            }),
            jsx('button', {
              type: 'button',
              onClick: () => { void saveCredential(ref); },
              disabled: !draftVal || busy,
              style: { padding: '5px 14px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', cursor: draftVal && !busy ? 'pointer' : 'default', fontSize: 12.5, whiteSpace: 'nowrap' },
              children: busy ? tr('settings.saving') : tr('settings.cred.save'),
            }),
            done ? jsx('span', { style: { fontSize: 11, color: 'var(--dsw-alias-state-success-primary)' }, children: tr('settings.cred.saved') + ' ✓' }) : null,
            err ? jsx('span', { style: { fontSize: 11, color: 'var(--dsw-alias-state-error-primary)' }, children: tr('settings.cred.failed') }) : null,
            hintKey ? jsx('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)', flexBasis: '100%' }, children: tr(hintKey) }) : null,
          ],
        });
      };

      const footer = jsx('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }, children: [
        jsx('button', {
          type: 'button',
          onClick: () => { void save(); },
          disabled: Object.keys(draft).length === 0 || saving || !writable,
          style: {
            height: 30, padding: '0 16px', borderRadius: 8,
            border: '1px solid var(--dsw-alias-state-business-primary)',
            background: 'var(--dsw-alias-state-business-primary)',
            color: 'var(--dsw-alias-label-primary-inverted)',
            fontSize: 13, fontWeight: 500,
            cursor: Object.keys(draft).length > 0 && !saving && writable ? 'pointer' : 'default',
          },
          children: saving ? tr('settings.saving') : tr('settings.save'),
        }),
        jsx('button', {
          type: 'button',
          onClick: discard,
          disabled: Object.keys(draft).length === 0 || saving || !writable,
          style: {
            height: 30, padding: '0 16px', borderRadius: 8,
            border: '1px solid var(--dsw-alias-border-l2)',
            background: 'transparent',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 13,
            cursor: Object.keys(draft).length > 0 && !saving && writable ? 'pointer' : 'default',
          },
          children: tr('settings.discard'),
        }),
        saved ? jsx('span', { style: { fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' }, children: tr('settings.saved') }) : null,
        failed ? jsx('span', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' }, children: tr('settings.failed') }) : null,
      ]});

      if (!writable) {
        return jsx('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary)' }, children: tr('settings.readonly') });
      }

      return jsx('div', { children: [
        jsx('div', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-secondary)', margin: '0 0 14px' }, children: tr('settings.intro') }),
        ...GROUPS.map(renderGroup).filter(Boolean),
        footer,
      ]});
    }

    /** One labelled field row (label + control + hint). */
    function FieldRow({ spec, t, value, onChange }) {
      const label = t(spec.labelKey);
      const hint = spec.hintKey ? t(spec.hintKey) : null;
      let input;
      if (spec.type === 'select') {
        input = jsx('select', {
          value: value === undefined || value === null ? '' : value,
          onChange: (e) => onChange(pathKey(spec.path), e.target.value),
          style: { width: 200, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', fontSize: 12.5 },
          children: (spec.options || []).map((opt) => jsx('option', { key: opt, value: opt, children: opt })),
        });
      } else if (spec.type === 'number' || spec.type === 'secMs') {
        input = jsx('input', {
          type: 'number',
          value: value === undefined || value === null ? '' : value,
          onChange: (e) => onChange(pathKey(spec.path), e.target.value),
          style: { width: 120, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', fontSize: 12.5, fontVariantNumeric: 'tabular-nums' },
        });
      } else {
        input = jsx('input', {
          type: 'text',
          value: value === undefined || value === null ? '' : value,
          onChange: (e) => onChange(pathKey(spec.path), e.target.value),
          style: { width: 200, padding: '4px 8px', borderRadius: 6, border: '1px solid rgba(128,128,128,0.35)', background: 'transparent', color: 'inherit', fontSize: 12.5 },
        });
      }
      return jsxs('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }, children: [
        jsx('div', { style: { flex: '1 1 220px', minWidth: 0 }, children: [
          jsx('div', { style: { fontSize: 12.5, lineHeight: '18px', color: 'var(--dsw-alias-label-primary)' }, children: label }),
          hint ? jsx('div', { style: { fontSize: 11, lineHeight: '15px', color: 'var(--dsw-alias-label-tertiary)' }, children: hint }) : null,
        ]}),
        input,
      ]});
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
