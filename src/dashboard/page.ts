export const dashboardHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#455230">
<meta name="description" content="Notification Service — manage applications, email templates, registration events and delivery integrations from one dashboard.">
<title>Notification Service • Dashboard</title>
<style>
:root{--bg:#f4f4eb;--paper:#fffef9;--green:#455230;--olive:#637545;--edge:#d9dfcd;--muted:#6f7468}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#28301e;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
h1{font-size:clamp(24px,3vw,32px);letter-spacing:-.035em;margin:0 0 7px}h2{font-size:17px;margin:0}p{color:var(--muted);margin:7px 0 20px}
button,input,textarea,select{font:inherit}button{border:0;background:var(--green);color:white;border-radius:9px;padding:10px 15px;cursor:pointer;font-weight:600}
button:hover{background:var(--olive)}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid #8ca466;outline-offset:2px}button:disabled{opacity:.55;cursor:not-allowed}button.secondary{background:#e5eadb;color:var(--green)}button.danger{background:#9f443e}
input,textarea,select{width:100%;background:white;border:1px solid #cbd4bd;padding:10px 12px;border-radius:9px;color:#28301e}
textarea{min-height:140px;font-family:ui-monospace,monospace}
label{font-size:12px;color:var(--muted);font-weight:600;display:block;margin-bottom:5px}
.field{margin-bottom:14px}
#login{max-width:420px;margin:13vh auto;padding:30px;background:var(--paper);border:1px solid var(--edge);border-radius:18px;box-shadow:0 12px 50px #28301e12}
.layout{display:grid;grid-template-columns:240px 1fr;min-height:100vh}
aside{background:#e8ecd9;padding:27px 20px;border-right:1px solid #d3dac6;display:flex;flex-direction:column;gap:3px;position:sticky;top:0;height:100vh;overflow-y:auto}
.brand{font-weight:800;color:var(--green);font-size:20px;letter-spacing:-.04em;margin:0 0 20px;display:flex;align-items:center;gap:10px}
.brandmark{display:inline-grid;place-items:center;background:var(--green);color:#fff;border-radius:12px;width:39px;height:39px;font-size:21px;flex-shrink:0}
.side-label{font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#737f63;font-weight:800;margin:16px 12px 7px}
.sidebar-bottom{margin-top:auto;padding:16px 12px 0;border-top:1px solid #cbd4bd}
.sidebar-bottom p{font-size:12px;margin:5px 0 11px}
.sidebar-bottom a{color:var(--green);font-weight:650;text-decoration:none}
.sidebar-bottom a:hover{text-decoration:underline}
.nav{display:block;width:100%;background:transparent;color:var(--green);text-align:left;margin:2px 0;padding:11px 13px;transition:background .15s,transform .15s}
.nav:hover{background:#d9e1cc;transform:translateX(2px)}
.nav.active:hover{background:var(--olive)}
.nav.active{background:var(--green);color:white}
main{padding:32px clamp(18px,3.5vw,52px) 0;max-width:1450px;width:100%;min-width:0;display:flex;flex-direction:column;min-height:100vh}
.top{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:26px}
.panel{background:var(--paper);border:1px solid var(--edge);border-radius:16px;padding:clamp(16px,2.4vw,26px);margin:10px 0 28px;box-shadow:0 8px 32px #28301e08}
#body{flex:1;min-width:0;overflow-x:auto}
.head{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px}
.actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.stack{display:grid;gap:12px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
table{border-collapse:collapse;width:100%;text-align:left}
th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
td,th{border-bottom:1px solid var(--edge);padding:13px 9px;vertical-align:middle}
td button{padding:7px 10px;font-size:12px}
small,.hint{color:var(--muted)}
.pill{background:#e4e9da;padding:4px 8px;border-radius:20px;font-size:12px}
#notice{position:fixed;bottom:18px;right:18px;max-width:460px;background:#28301e;color:#fff;padding:12px 18px;border-radius:10px;display:none;box-shadow:0 8px 32px #0003}
.empty{text-align:center;color:var(--muted);padding:50px 0}
.hidden{display:none!important}
.top p{margin:5px 0;color:var(--muted)}
.page-eyebrow{color:var(--olive);font-size:11px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;margin-bottom:7px}
.footer{border-top:1px solid var(--edge);padding:24px 0 20px;color:var(--muted);font-size:12px;margin-top:auto}
.footer-main{display:grid;grid-template-columns:minmax(200px,1.7fr) repeat(2,minmax(120px,1fr));gap:22px;margin-bottom:20px}
.footer strong{display:block;color:#39482a;font-size:13px;margin-bottom:10px}
.footer p{margin:4px 0;max-width:410px;font-size:12px;line-height:1.7}
.footer a{color:#455230;text-decoration:none;display:inline-block;margin:4px 0}
.footer a:hover{text-decoration:underline}
.footer nav{display:grid;gap:3px}
.footer-line{border-top:1px solid var(--edge);padding-top:16px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}
.login-shell{min-height:100vh;display:flex;flex-direction:column;padding:20px}
#login{width:100%;margin:auto;max-width:440px}
#login .brand{margin-bottom:24px}
#login button[type=submit]{width:100%;margin-top:5px}
.login-shell>.footer{max-width:1150px;width:100%;margin:36px auto 0}
.service-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#93a47b;margin-right:5px}
.service-meta{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
table{min-width:590px}
button{display:inline-flex;align-items:center;justify-content:center;gap:9px;position:relative;min-height:38px;transition:background-color .18s,box-shadow .18s,opacity .18s,transform .18s}
button:active:not(:disabled){transform:scale(.985)}
button[aria-busy="true"]{cursor:progress;opacity:.76}
button[aria-busy="true"]::before{content:'';width:14px;height:14px;flex:0 0 auto;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .75s linear infinite}
#loginForm button{min-height:46px}
#loginError{color:#a13932;min-height:1.4em;margin:14px 0 0;font-size:13px}
#loginProgress{min-height:19px;margin:10px 0 0;font-size:12px;color:var(--olive)}
#body[aria-busy="true"]{min-height:310px}
.skeleton{display:grid;gap:16px;max-width:100%;padding:4px 0 18px}
.skeleton-head{display:flex;gap:16px;justify-content:space-between;margin-bottom:12px}
.skeleton-block{background:linear-gradient(100deg,#e7ebde 8%,#f5f6ef 20%,#e7ebde 38%);background-size:200% 100%;border-radius:9px;animation:shimmer 1.5s linear infinite}
.skeleton-title{width:38%;max-width:245px;height:25px}
.skeleton-button{width:120px;height:38px}
.skeleton-line{width:100%;height:19px}
.skeleton-line:nth-child(3n){width:79%}
.skeleton-line:nth-child(4n){width:91%}
#notice{z-index:20;display:none;align-items:center;gap:10px;min-width:230px;border:1px solid #4f6451;box-shadow:0 16px 36px #0002;animation:slide-in .22s ease-out}
#notice[data-type="error"]{background:#8c3735;border-color:#b65c54}
#notice[data-type="success"]{background:#354f38}
#notice::before{content:'✓';font-weight:800;font-size:17px}
#notice[data-type="error"]::before{content:'!'}
.error-state{display:grid;justify-items:start;gap:12px;padding:25px;min-height:180px;align-content:center;background:#fff9f4;border:1px solid #e8d1c3;border-radius:12px}
.error-state strong{font-size:16px;color:#7f3730}
.error-state p{margin:0}
.nav[aria-current="page"]{box-shadow:inset 3px 0 0 #baca9d}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes shimmer{to{background-position-x:-200%}}
@keyframes slide-in{from{transform:translateY(10px);opacity:0}to{transform:translateY(0);opacity:1}}
@media(prefers-reduced-motion:reduce){.skeleton-block,button[aria-busy="true"]::before,#notice{animation:none!important}button,.nav{transition:none!important}}
@media(max-width:800px){.layout{display:block}aside{padding:14px;border:0;position:static;height:auto;display:block}.brand{margin-bottom:12px}.side-label{display:none}.nav{display:inline-block;width:auto;font-size:12px;margin:2px;padding:10px}.nav:hover{transform:none}.sidebar-bottom{display:flex;align-items:center;gap:16px;margin-top:10px;padding:8px 0 0}.sidebar-bottom p{display:none}.sidebar-bottom button{margin-top:0!important}main{padding:18px;min-height:70vh}.grid{grid-template-columns:1fr}.top{flex-wrap:wrap}.footer-main{grid-template-columns:1fr 1fr}.footer-main>div:first-child{grid-column:1/-1}}
@media(max-width:480px){.footer-main{grid-template-columns:1fr}.footer-main>div:first-child{grid-column:auto}#login{padding:22px}.top select{max-width:100%}}
</style>
</head><body>
<div id="loginShell" class="login-shell">
<section id="login">
<div class="brand"><span class="brandmark" aria-hidden="true">✉</span><span>Notification Service</span></div>
<h1>Welcome back</h1><p>Use your Auth Service account to manage applications, templates, and users.</p>
<form id="loginForm"><div class="field"><label>Email</label><input id="loginEmail" type="email" autocomplete="username" required></div>
<div class="field"><label>Password</label><input id="loginPassword" type="password" autocomplete="current-password" required></div>
<button type="submit" id="loginSubmit"><span id="loginSubmitText">Sign in</span></button></form>
<p id="loginProgress" role="status" aria-live="polite"></p><p id="loginError" role="alert" aria-live="assertive"></p>
</section>
<footer class="footer" aria-label="Website information">
  <div class="footer-main">
    <div><strong>✉ Notification Service</strong>
      <p>Centralized notifications for your applications. Manage email templates, registration events, recipients and API access in one place.</p>
      <p class="service-meta"><span class="service-dot" aria-hidden="true"></span> Dashboard &amp; notification API</p>
    </div>
    <div><strong>Platform</strong><nav aria-label="Platform links">
      <a href="/dashboard">Dashboard</a>
      <a href="/health" target="_blank" rel="noopener noreferrer">Service health</a>
      <a href="/ready" target="_blank" rel="noopener noreferrer">Dependency readiness</a>
    </nav></div>
    <div><strong>Resources &amp; support</strong><nav aria-label="Resource links">
      <a href="https://github.com/Arpitruh/Notification-Service" target="_blank" rel="noopener noreferrer">Source repository</a>
      <a href="https://github.com/Arpitruh/Notification-Service/blob/master/docs/DASHBOARD_EVENT_CONFIGURATION.md" target="_blank" rel="noopener noreferrer">Integration guide</a>
      <a href="https://github.com/Arpitruh/Notification-Service/issues" target="_blank" rel="noopener noreferrer">Report an issue</a>
    </nav></div>
  </div>
  <div class="footer-line"><span>© <span class="copyright-year">2026</span> Notification Service. All rights reserved.</span><span>Application notification management · v1.0</span></div>
</footer>
</div>
<div id="workspace" class="layout hidden">
<aside><div class="brand"><span class="brandmark" aria-hidden="true">✉</span><span>Notification Service</span></div>
<div class="side-label">Workspace</div>
<button class="nav" data-section="applications">▦ Applications</button>
<button class="nav active" data-section="templates">✉ Mail Templates</button>
<button class="nav" data-section="users">♙ Application Users</button>
<button class="nav" data-section="team">♧ Team Access</button>
<button class="nav" data-section="audit">☷ Audit History</button>
<div class="side-label">Administration</div>
<button class="nav" data-section="settings">⚙ App Settings</button>
<button class="nav" data-section="credentials">⚿ API Keys</button>
<div class="sidebar-bottom"><p>Connected application management</p><button id="logout" class="secondary">↪ Log out</button></div></aside>
<main><div class="top"><div><div class="page-eyebrow">Application management</div><h1 id="pageTitle">Mail Templates</h1><p>Everything organized by application.</p></div>
<div style="min-width:220px"><label>Selected application</label><select id="appSelect"></select></div></div>
<section id="body" class="panel" aria-live="polite" aria-busy="false"><div class="empty">Loading workspace…</div></section>
<footer class="footer" aria-label="Website information">
  <div class="footer-main">
    <div><strong>✉ Notification Service</strong>
      <p>Centralized notifications for your applications. Manage email templates, registration events, recipients and API access in one place.</p>
      <p class="service-meta"><span class="service-dot" aria-hidden="true"></span> Dashboard &amp; notification API</p>
    </div>
    <div><strong>Platform</strong><nav aria-label="Platform links">
      <a href="/dashboard">Dashboard</a>
      <a href="/health" target="_blank" rel="noopener noreferrer">Service health</a>
      <a href="/ready" target="_blank" rel="noopener noreferrer">Dependency readiness</a>
    </nav></div>
    <div><strong>Resources &amp; support</strong><nav aria-label="Resource links">
      <a href="https://github.com/Arpitruh/Notification-Service" target="_blank" rel="noopener noreferrer">Source repository</a>
      <a href="https://github.com/Arpitruh/Notification-Service/blob/master/docs/DASHBOARD_EVENT_CONFIGURATION.md" target="_blank" rel="noopener noreferrer">Integration guide</a>
      <a href="https://github.com/Arpitruh/Notification-Service/issues" target="_blank" rel="noopener noreferrer">Report an issue</a>
    </nav></div>
  </div>
  <div class="footer-line"><span>© <span class="copyright-year">2026</span> Notification Service. All rights reserved.</span><span>Application notification management · v1.0</span></div>
</footer>
</main></div><div id="notice" role="status" aria-live="polite" aria-atomic="true"></div>
<script>
(() => {
const $ = id => document.getElementById(id);
document.querySelectorAll('.copyright-year').forEach(node=>node.textContent=String(new Date().getFullYear()));
const state={token:'',apps:[],appId:'',section:'templates',loginPending:false,renderVersion:0};
let noticeTimer;
function show(message,type='success'){const node=$('notice');clearTimeout(noticeTimer);node.textContent=message;node.dataset.type=type;node.style.display='flex';noticeTimer=setTimeout(()=>node.style.display='none',5000)}
function setBusy(button,busy){if(!button)return;button.disabled=busy;button.setAttribute('aria-busy',String(busy))}
function skeleton(){const root=$('body');root.setAttribute('aria-busy','true');const wrap=el('div',undefined,{class:'skeleton','aria-label':'Loading '+state.section});const head=el('div',undefined,{class:'skeleton-head'});head.append(el('div',undefined,{class:'skeleton-block skeleton-title'}),el('div',undefined,{class:'skeleton-block skeleton-button'}));wrap.append(head);for(let i=0;i<7;i++)wrap.append(el('div',undefined,{class:'skeleton-block skeleton-line'}));root.replaceChildren(wrap)}
function failure(message){const root=panel(),box=el('div',undefined,{class:'error-state',role:'alert'});box.append(el('strong','Could not load this section'),el('p',message),action('Try again',()=>render(),'secondary'));root.append(box)}
function el(tag,text,attrs={}){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);return node}
function action(text,fn,cls){const b=el('button',text,{type:'button'});if(cls)b.className=cls;b.addEventListener('click',async()=>{if(b.disabled)return;setBusy(b,true);try{await fn()}catch(err){show(err?.message||'Something went wrong','error')}finally{setBusy(b,false)}});return b}
function header(title,buttons=[]){const h=el('div',undefined,{class:'head'});h.append(el('h2',title));const a=el('div',undefined,{class:'actions'});buttons.forEach(b=>a.append(b));h.append(a);return h}
function table(headings,rows){const t=el('table'),thead=el('thead'),tr=el('tr');headings.forEach(h=>tr.append(el('th',h)));thead.append(tr);t.append(thead);const tb=el('tbody');rows.forEach(cells=>{const r=el('tr');cells.forEach(c=>{const d=el('td');d.append(c instanceof Node?c:document.createTextNode(String(c??'')));r.append(d)});tb.append(r)});t.append(tb);return t}
function panel(){const root=$('body');root.replaceChildren();root.setAttribute('aria-busy','false');return root}
function field(form,label,type,value='',name=label){const box=el('div',undefined,{class:'field'});box.append(el('label',label));const input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.name=name;input.value=value;input.required=label.includes('*');box.append(input);form.append(box);return input}
async function api(path,opts={}){const response=await fetch('/api/v1/dashboard'+path,{...opts,headers:{'Content-Type':'application/json',Authorization:'Bearer '+state.token,...opts.headers}});if(response.status===204)return{};const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data}
async function loadSection(path){const version=state.renderVersion;const data=await api(path);if(version!==state.renderVersion)throw Error('stale');return data}
async function reloadApps(){const data=await api('/applications');state.apps=data.applications;const sel=$('appSelect');const previous=state.appId;sel.replaceChildren();data.applications.forEach(a=>sel.append(el('option',a.name+' ('+a.slug+')',{value:a.id})));state.appId=data.applications.some(a=>a.id===previous)?previous:data.applications[0]?.id||'';sel.value=state.appId}
async function render(){const version=++state.renderVersion;skeleton();const titles={templates:'Mail Templates',users:'Application Users',team:'Team Access',audit:'Audit History',applications:'Applications',settings:'Application Settings',credentials:'API Keys'};$('pageTitle').textContent=titles[state.section];document.querySelectorAll('.nav').forEach(n=>{const active=n.dataset.section===state.section;n.classList.toggle('active',active);if(active)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current')});try{if(state.section==='applications')return await apps();if(!state.appId){panel().append(el('p','No applications available. A platform administrator must create one.'));return}if(state.section==='templates')await templates();if(state.section==='users')await users();if(state.section==='team')await team();if(state.section==='audit')await audit();if(state.section==='settings')await settings();if(state.section==='credentials')await credentials()}catch(e){if(version===state.renderVersion){failure(e.message);show(e.message,'error')}}}
async function apps(){const p=panel();p.append(header('Registered applications',[action('Add application',()=>appEditor())]));p.append(table(['Name','Slug','Status'],state.apps.map(a=>[a.name,a.slug,a.enabled?'Enabled':'Disabled'])))}
async function appEditor(){const p=panel();p.append(header('New application',[action('Back',render,'secondary')]));const f=el('form');const slug=field(f,'Slug *','text');const name=field(f,'Name *','text');f.append(action('Create application',async()=>{try{await api('/applications',{method:'POST',body:JSON.stringify({slug:slug.value,name:name.value})});await reloadApps();show('Application created');render()}catch(e){show(e.message,'error')}}));p.append(f)}
async function templates(){const {templates:items}=await loadSection('/applications/'+state.appId+'/templates');const p=panel();p.append(header('Email templates',[action('Create template',()=>templateEditor())]));if(!items.length){p.append(el('div','No templates yet. Create a draft to begin.',{class:'empty'}));return}p.append(table(['Name','Subject','Version','Status','Actions'],items.map(t=>[t.slug,t.subject,'v'+t.version,t.archived?'Archived':t.published?'Published':'Draft',(()=>{
const x=el('div',undefined,{class:'actions'});x.append(action('Edit',()=>templateEditor(t),'secondary'));if(t.archived)x.append(action('Restore',async()=>{try{await api('/applications/'+state.appId+'/templates/'+t.id,{method:'PATCH',body:JSON.stringify({archived:false})});show('Restored as draft');render()}catch(e){show(e.message,'error')}},'secondary'));if(!t.archived)x.append(action('Archive',async()=>{if(!confirm('Archive this template?'))return;try{await api('/applications/'+state.appId+'/templates/'+t.id,{method:'DELETE'});show('Archived');render()}catch(e){show(e.message,'error')}},'danger'));return x})()])))}
function templateEditor(t){const p=panel(), editing=!!t;p.append(header(editing?'Edit template':'New template',[action('Back',render,'secondary')]));const f=el('form');const slug=field(f,'Slug *','text',t?.slug||'');if(editing)slug.disabled=true;const subject=field(f,'Subject *','text',t?.subject||'');const html=field(f,'HTML body *','textarea',t?.html||'<p>Hello {{name}}</p>');const vars=field(f,'Required variables (comma separated)','text',Array.isArray(t?.required_variables)?t.required_variables.join(', '):'name');const wrap=el('div',undefined,{class:'field'}), lab=el('label','Published'),pub=el('input');pub.type='checkbox';pub.style.width='auto';pub.checked=t?.published||false;wrap.append(lab,pub);f.append(wrap);
const preview=el('div',undefined,{class:'panel'});preview.append(el('h2','Preview'));const frame=el('iframe');frame.title='Email template preview';frame.setAttribute('sandbox','');frame.style='width:100%;border:1px solid #d9dfcd;background:#fff;min-height:180px;margin-top:12px';preview.append(frame);const renderPreview=()=>{frame.srcdoc=html.value.replace(/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g,'Sample')};html.addEventListener('input',renderPreview);renderPreview();
const b=action(editing?'Save changes':'Create draft',async()=>{try{const data={subject:subject.value,html:html.value,requiredVariables:vars.value.split(',').map(v=>v.trim()).filter(Boolean)};if(editing){data.published=pub.checked;if(t.archived)data.published=false;}else data.slug=slug.value;await api('/applications/'+state.appId+'/templates'+(editing?'/'+t.id:''),{method:editing?'PATCH':'POST',body:JSON.stringify(data)});show('Template saved');render()}catch(e){show(e.message,'error')}});f.append(b);p.append(f,preview)}
async function users(){const {users:items}=await loadSection('/applications/'+state.appId+'/users');const p=panel();p.append(header('Notification recipients',[action('Add user',()=>userEditor())]));if(!items.length){p.append(el('div','No users added to this application.',{class:'empty'}));return}p.append(table(['External ID','Name','Email','Status','Actions'],items.map(u=>[u.external_id,u.name||'—',u.email||'—',u.enabled?'Active':'Inactive',(()=>{const a=el('div',undefined,{class:'actions'});a.append(action('Edit',()=>userEditor(u),'secondary'));if(u.enabled)a.append(action('Deactivate',async()=>{if(!confirm('Deactivate recipient?'))return;try{await api('/applications/'+state.appId+'/users/'+u.id,{method:'DELETE'});show('User deactivated');render()}catch(e){show(e.message,'error')}},'secondary'));return a})()])))}
function userEditor(u){const p=panel();p.append(header('Add or update recipient',[action('Back',render,'secondary')]));const f=el('form');const id=field(f,'External user ID *','text',u?.external_id||'');if(u)id.disabled=true;const name=field(f,'Name','text',u?.name||'');const email=field(f,'Email','email',u?.email||'');f.append(action('Save user',async()=>{try{await api('/applications/'+state.appId+'/users',{method:'POST',body:JSON.stringify({externalId:id.value,name:name.value||null,email:email.value||null,enabled:u?.enabled??true})});show('User saved');render()}catch(e){show(e.message,'error')}}));p.append(f)}
async function team(){const {members}=await loadSection('/applications/'+state.appId+'/members');const p=panel();p.append(header('Dashboard members',[action('Add or change member',memberEditor)]));p.append(table(['Auth Service subject','Role'],members.map(m=>[m.auth_subject,m.role])))}
function memberEditor(){const p=panel();p.append(header('Grant application access',[action('Back',render,'secondary')]));const f=el('form');const sub=field(f,'Auth Service subject ID *','text');const role=el('select');['viewer','editor','admin','owner'].forEach(r=>role.append(el('option',r,{value:r})));f.append(role,action('Save member',async()=>{try{await api('/applications/'+state.appId+'/members',{method:'PUT',body:JSON.stringify({subject:sub.value,role:role.value})});show('Access updated');render()}catch(e){show(e.message,'error')}}));p.append(f)}

async function settings(){
  const data=await loadSection('/applications/'+state.appId+'/settings');const s=data.settings,p=panel();
  p.append(header('Application settings'));
  const f=el('form');const name=field(f,'Application name *','text',s.name);
  const url=field(f,'Application dashboard / login URL','url',s.dashboardUrl||'');
  const template=field(f,'Welcome template slug *','text',s.welcomeTemplate||'welcome');
  const enabled=el('input');enabled.type='checkbox';enabled.style.width='auto';enabled.checked=s.welcomeEnabled;
  const label=el('label','Automatically send welcome mail on user registration');label.prepend(enabled);f.append(label);
  const info=el('p','An application must send a user.registered event from its backend using its API key. Template, URL and welcome toggle are controlled here.');
  f.append(info,action('Save settings',async()=>{
    try {
      const body={name:name.value,dashboardUrl:url.value||null,welcomeTemplate:template.value,welcomeEnabled:enabled.checked};
      await api('/applications/'+state.appId+'/settings',{method:'PATCH',body:JSON.stringify(body)});
      show('Application settings saved');await reloadApps();render();
    } catch(e){show(e.message,'error')}
  }));p.append(f);
}
async function credentials(){
  const {credentials:items}=await loadSection('/applications/'+state.appId+'/credentials');const p=panel();
  p.append(header('Application API keys',[action('Generate key',()=>createCredential())]));
  p.append(el('p','Keep API keys in your application backend only. Each key is shown once. Existing Render bootstrap keys still work until you rotate them.'));
  p.append(table(['Label','Prefix','Created','Status','Actions'],items.map(k=>[
    k.label,k.prefix,new Date(k.created_at).toLocaleString(),k.revoked_at?'Revoked':'Active',
    k.revoked_at?'—':action('Revoke',async()=>{if(!confirm('Revoke this key? Applications using it will stop sending notifications.'))return;
    try{await api('/applications/'+state.appId+'/credentials/'+k.id,{method:'DELETE'});show('Key revoked');render()}catch(e){show(e.message,'error')}},'danger')
  ])));
}
function createCredential(){
  const p=panel();p.append(header('Generate API key',[action('Back',render,'secondary')]));
  const f=el('form'),label=field(f,'Key label *','text','Backend integration');
  f.append(action('Generate once',async()=>{
    try{
      const key=await api('/applications/'+state.appId+'/credentials',{method:'POST',body:JSON.stringify({label:label.value})});
      p.replaceChildren(header('Your new API key'));
      p.append(el('p','Copy this secret now. It cannot be recovered after leaving this screen.'));
      const input=el('textarea');input.value=key.secret;input.readOnly=true;p.append(input);
      p.append(action('Copy key',()=>navigator.clipboard.writeText(key.secret)),action('Done',render,'secondary'));
    }catch(e){show(e.message,'error')}
  }));p.append(f);
}

async function audit(){const {events}=await loadSection('/applications/'+state.appId+'/audit');const p=panel();p.append(header('Recent changes'));p.append(table(['When','Operator','Action','Resource'],events.map(e=>[new Date(e.created_at).toLocaleString(),e.actor,e.action,e.resource_id||'—'])))}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();if(state.loginPending)return;state.loginPending=true;const button=$('loginSubmit');const inputs=[$('loginEmail'),$('loginPassword')];$('loginError').textContent='';$('loginProgress').textContent='Signing in securely…';$('loginSubmitText').textContent='Signing in…';setBusy(button,true);inputs.forEach(input=>input.readOnly=true);try{const response=await fetch('/api/v1/dashboard/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('loginEmail').value,password:$('loginPassword').value}),signal:AbortSignal.timeout(25000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Login failed');state.token=data.accessToken;$('loginProgress').textContent='Loading your workspace…';await reloadApps();$('loginPassword').value='';$('loginShell').classList.add('hidden');$('workspace').classList.remove('hidden');await render();show('Welcome back. Your workspace is ready.')}catch(err){state.token='';$('loginError').textContent=err?.message||'Could not sign in. Please try again.';show($('loginError').textContent,'error')}finally{state.loginPending=false;setBusy(button,false);$('loginSubmitText').textContent='Sign in';$('loginProgress').textContent='';inputs.forEach(input=>input.readOnly=false)}});
$('logout').addEventListener('click',()=>{state.token='';$('workspace').classList.add('hidden');$('loginShell').classList.remove('hidden')});
$('appSelect').addEventListener('change',e=>{state.appId=e.target.value;render()});
document.querySelectorAll('.nav').forEach(n=>n.addEventListener('click',()=>{state.section=n.dataset.section;render()}));
})();
</script></body></html>`;