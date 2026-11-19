export const dashboardHtml = /* html */ `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Notification Garden • Dashboard</title>
<style>
:root{--bg:#f4f4eb;--paper:#fffef9;--green:#455230;--olive:#637545;--edge:#d9dfcd;--muted:#6f7468}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:#28301e;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}
h1{font-size:28px;margin:0 0 7px}h2{font-size:17px;margin:0}p{color:var(--muted);margin:7px 0 20px}
button,input,textarea,select{font:inherit}button{border:0;background:var(--green);color:white;border-radius:9px;padding:10px 15px;cursor:pointer;font-weight:600}
button:hover{background:var(--olive)}button.secondary{background:#e5eadb;color:var(--green)}button.danger{background:#9f443e}
input,textarea,select{width:100%;background:white;border:1px solid #cbd4bd;padding:10px 12px;border-radius:9px;color:#28301e}
textarea{min-height:140px;font-family:ui-monospace,monospace}
label{font-size:12px;color:var(--muted);font-weight:600;display:block;margin-bottom:5px}
.field{margin-bottom:14px}
#login{max-width:420px;margin:13vh auto;padding:30px;background:var(--paper);border:1px solid var(--edge);border-radius:18px;box-shadow:0 12px 50px #28301e12}
.layout{display:grid;grid-template-columns:240px 1fr;min-height:100vh}
aside{background:#e8ecd9;padding:27px 20px;border-right:1px solid #d3dac6}
.brand{font-weight:800;color:var(--green);font-size:21px;margin:0 0 30px}
.nav{display:block;width:100%;background:transparent;color:var(--green);text-align:left;margin:4px 0;padding:12px}
.nav.active{background:var(--green);color:white}
main{padding:32px 40px;max-width:1350px;width:100%}
.top{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:26px}
.panel{background:var(--paper);border:1px solid var(--edge);border-radius:14px;padding:22px;margin:18px 0}
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
@media(max-width:800px){.layout{display:block}aside{padding:14px;border:0}.nav{display:inline-block;width:auto}main{padding:18px}.grid{grid-template-columns:1fr}.top{flex-wrap:wrap}}
</style>
</head><body>
<section id="login">
<div class="brand">✉ Notification Garden</div>
<h1>Dashboard Login</h1><p>Use your Auth Service account to manage applications, templates, and users.</p>
<form id="loginForm"><div class="field"><label>Email</label><input id="loginEmail" type="email" autocomplete="username" required></div>
<div class="field"><label>Password</label><input id="loginPassword" type="password" autocomplete="current-password" required></div>
<button type="submit">Sign in</button></form>
<p id="loginError" role="alert"></p>
</section>
<div id="workspace" class="layout hidden">
<aside><div class="brand">✉ Notification Garden</div>
<button class="nav active" data-section="templates">✉ Mail Templates</button>
<button class="nav" data-section="users">♙ Application Users</button>
<button class="nav" data-section="team">♧ Team Access</button>
<button class="nav" data-section="audit">☷ Audit History</button>
<button class="nav" data-section="applications">▦ Applications</button>
<button class="nav" data-section="settings">⚙ App Settings</button>
<button class="nav" data-section="credentials">⚿ API Keys</button>
<button id="logout" class="secondary" style="margin-top:24px">Log out</button></aside>
<main><div class="top"><div><h1 id="pageTitle">Mail Templates</h1><p>Everything organized by application.</p></div>
<div style="min-width:220px"><label>Selected application</label><select id="appSelect"></select></div></div>
<section id="body" class="panel"><div class="empty">Loading…</div></section>
</main></div><div id="notice" role="status"></div>
<script>
(() => {
const $ = id => document.getElementById(id);
const state={token:'',apps:[],appId:'',section:'templates'};
function show(message){$('notice').textContent=message;$('notice').style.display='block';setTimeout(()=>$('notice').style.display='none',4500)}
function el(tag,text,attrs={}){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);for(const [k,v] of Object.entries(attrs))node.setAttribute(k,v);return node}
function action(text,fn,cls){const b=el('button',text,{type:'button'});if(cls)b.className=cls;b.addEventListener('click',fn);return b}
function header(title,buttons=[]){const h=el('div',undefined,{class:'head'});h.append(el('h2',title));const a=el('div',undefined,{class:'actions'});buttons.forEach(b=>a.append(b));h.append(a);return h}
function table(headings,rows){const t=el('table'),thead=el('thead'),tr=el('tr');headings.forEach(h=>tr.append(el('th',h)));thead.append(tr);t.append(thead);const tb=el('tbody');rows.forEach(cells=>{const r=el('tr');cells.forEach(c=>{const d=el('td');d.append(c instanceof Node?c:document.createTextNode(String(c??'')));r.append(d)});tb.append(r)});t.append(tb);return t}
function panel(){const root=$('body');root.replaceChildren();return root}
function field(form,label,type,value='',name=label){const box=el('div',undefined,{class:'field'});box.append(el('label',label));const input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.name=name;input.value=value;input.required=label.includes('*');box.append(input);form.append(box);return input}
async function api(path,opts={}){const response=await fetch('/api/v1/dashboard'+path,{...opts,headers:{'Content-Type':'application/json',Authorization:'Bearer '+state.token,...opts.headers}});if(response.status===204)return{};const data=await response.json();if(!response.ok)throw Error(data.error||'Request failed');return data}
async function reloadApps(){const data=await api('/applications');state.apps=data.applications;const sel=$('appSelect');const previous=state.appId;sel.replaceChildren();data.applications.forEach(a=>sel.append(el('option',a.name+' ('+a.slug+')',{value:a.id})));state.appId=data.applications.some(a=>a.id===previous)?previous:data.applications[0]?.id||'';sel.value=state.appId}
async function render(){const titles={templates:'Mail Templates',users:'Application Users',team:'Team Access',audit:'Audit History',applications:'Applications',settings:'Application Settings',credentials:'API Keys'};$('pageTitle').textContent=titles[state.section];document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.section===state.section));try{if(state.section==='applications')return await apps();if(!state.appId){panel().append(el('p','No applications available. A platform administrator must create one.'));return}if(state.section==='templates')await templates();if(state.section==='users')await users();if(state.section==='team')await team();if(state.section==='audit')await audit();if(state.section==='settings')await settings();if(state.section==='credentials')await credentials()}catch(e){panel().append(el('p',e.message));show(e.message)}}
async function apps(){const p=panel();p.append(header('Registered applications',[action('Add application',()=>appEditor())]));p.append(table(['Name','Slug','Status'],state.apps.map(a=>[a.name,a.slug,a.enabled?'Enabled':'Disabled'])))}
async function appEditor(){const p=panel();p.append(header('New application',[action('Back',render,'secondary')]));const f=el('form');const slug=field(f,'Slug *','text');const name=field(f,'Name *','text');f.append(action('Create application',async()=>{try{await api('/applications',{method:'POST',body:JSON.stringify({slug:slug.value,name:name.value})});await reloadApps();show('Application created');render()}catch(e){show(e.message)}}));p.append(f)}
async function templates(){const {templates:items}=await api('/applications/'+state.appId+'/templates');const p=panel();p.append(header('Email templates',[action('Create template',()=>templateEditor())]));if(!items.length){p.append(el('div','No templates yet. Create a draft to begin.',{class:'empty'}));return}p.append(table(['Name','Subject','Version','Status','Actions'],items.map(t=>[t.slug,t.subject,'v'+t.version,t.archived?'Archived':t.published?'Published':'Draft',(()=>{
const x=el('div',undefined,{class:'actions'});x.append(action('Edit',()=>templateEditor(t),'secondary'));if(t.archived)x.append(action('Restore',async()=>{try{await api('/applications/'+state.appId+'/templates/'+t.id,{method:'PATCH',body:JSON.stringify({archived:false})});show('Restored as draft');render()}catch(e){show(e.message)}},'secondary'));if(!t.archived)x.append(action('Archive',async()=>{if(!confirm('Archive this template?'))return;try{await api('/applications/'+state.appId+'/templates/'+t.id,{method:'DELETE'});show('Archived');render()}catch(e){show(e.message)}},'danger'));return x})()])))}
function templateEditor(t){const p=panel(), editing=!!t;p.append(header(editing?'Edit template':'New template',[action('Back',render,'secondary')]));const f=el('form');const slug=field(f,'Slug *','text',t?.slug||'');if(editing)slug.disabled=true;const subject=field(f,'Subject *','text',t?.subject||'');const html=field(f,'HTML body *','textarea',t?.html||'<p>Hello {{name}}</p>');const vars=field(f,'Required variables (comma separated)','text',Array.isArray(t?.required_variables)?t.required_variables.join(', '):'name');const wrap=el('div',undefined,{class:'field'}), lab=el('label','Published'),pub=el('input');pub.type='checkbox';pub.style.width='auto';pub.checked=t?.published||false;wrap.append(lab,pub);f.append(wrap);
const preview=el('div',undefined,{class:'panel'});preview.append(el('h2','Preview'));const frame=el('iframe');frame.title='Email template preview';frame.setAttribute('sandbox','');frame.style='width:100%;border:1px solid #d9dfcd;background:#fff;min-height:180px;margin-top:12px';preview.append(frame);const renderPreview=()=>{frame.srcdoc=html.value.replace(/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g,'Sample')};html.addEventListener('input',renderPreview);renderPreview();
const b=action(editing?'Save changes':'Create draft',async()=>{try{const data={subject:subject.value,html:html.value,requiredVariables:vars.value.split(',').map(v=>v.trim()).filter(Boolean)};if(editing){data.published=pub.checked;if(t.archived)data.published=false;}else data.slug=slug.value;await api('/applications/'+state.appId+'/templates'+(editing?'/'+t.id:''),{method:editing?'PATCH':'POST',body:JSON.stringify(data)});show('Template saved');render()}catch(e){show(e.message)}});f.append(b);p.append(f,preview)}
async function users(){const {users:items}=await api('/applications/'+state.appId+'/users');const p=panel();p.append(header('Notification recipients',[action('Add user',()=>userEditor())]));if(!items.length){p.append(el('div','No users added to this application.',{class:'empty'}));return}p.append(table(['External ID','Name','Email','Status','Actions'],items.map(u=>[u.external_id,u.name||'—',u.email||'—',u.enabled?'Active':'Inactive',(()=>{const a=el('div',undefined,{class:'actions'});a.append(action('Edit',()=>userEditor(u),'secondary'));if(u.enabled)a.append(action('Deactivate',async()=>{if(!confirm('Deactivate recipient?'))return;try{await api('/applications/'+state.appId+'/users/'+u.id,{method:'DELETE'});show('User deactivated');render()}catch(e){show(e.message)}},'secondary'));return a})()])))}
function userEditor(u){const p=panel();p.append(header('Add or update recipient',[action('Back',render,'secondary')]));const f=el('form');const id=field(f,'External user ID *','text',u?.external_id||'');if(u)id.disabled=true;const name=field(f,'Name','text',u?.name||'');const email=field(f,'Email','email',u?.email||'');f.append(action('Save user',async()=>{try{await api('/applications/'+state.appId+'/users',{method:'POST',body:JSON.stringify({externalId:id.value,name:name.value||null,email:email.value||null,enabled:u?.enabled??true})});show('User saved');render()}catch(e){show(e.message)}}));p.append(f)}
async function team(){const {members}=await api('/applications/'+state.appId+'/members');const p=panel();p.append(header('Dashboard members',[action('Add or change member',memberEditor)]));p.append(table(['Auth Service subject','Role'],members.map(m=>[m.auth_subject,m.role])))}
function memberEditor(){const p=panel();p.append(header('Grant application access',[action('Back',render,'secondary')]));const f=el('form');const sub=field(f,'Auth Service subject ID *','text');const role=el('select');['viewer','editor','admin','owner'].forEach(r=>role.append(el('option',r,{value:r})));f.append(role,action('Save member',async()=>{try{await api('/applications/'+state.appId+'/members',{method:'PUT',body:JSON.stringify({subject:sub.value,role:role.value})});show('Access updated');render()}catch(e){show(e.message)}}));p.append(f)}

async function settings(){
  const data=await api('/applications/'+state.appId+'/settings');const s=data.settings,p=panel();
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
    } catch(e){show(e.message)}
  }));p.append(f);
}
async function credentials(){
  const {credentials:items}=await api('/applications/'+state.appId+'/credentials');const p=panel();
  p.append(header('Application API keys',[action('Generate key',()=>createCredential())]));
  p.append(el('p','Keep API keys in your application backend only. Each key is shown once. Existing Render bootstrap keys still work until you rotate them.'));
  p.append(table(['Label','Prefix','Created','Status','Actions'],items.map(k=>[
    k.label,k.prefix,new Date(k.created_at).toLocaleString(),k.revoked_at?'Revoked':'Active',
    k.revoked_at?'—':action('Revoke',async()=>{if(!confirm('Revoke this key? Applications using it will stop sending notifications.'))return;
    try{await api('/applications/'+state.appId+'/credentials/'+k.id,{method:'DELETE'});show('Key revoked');render()}catch(e){show(e.message)}},'danger')
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
    }catch(e){show(e.message)}
  }));p.append(f);
}

async function audit(){const {events}=await api('/applications/'+state.appId+'/audit');const p=panel();p.append(header('Recent changes'));p.append(table(['When','Operator','Action','Resource'],events.map(e=>[new Date(e.created_at).toLocaleString(),e.actor,e.action,e.resource_id||'—'])))}
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';try{const response=await fetch('/api/v1/dashboard/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:$('loginEmail').value,password:$('loginPassword').value})});const data=await response.json();if(!response.ok)throw Error(data.error||'Login failed');state.token=data.accessToken;$('loginPassword').value='';await reloadApps();$('login').classList.add('hidden');$('workspace').classList.remove('hidden');render()}catch(err){$('loginError').textContent=err.message}});
$('logout').addEventListener('click',()=>{state.token='';$('workspace').classList.add('hidden');$('login').classList.remove('hidden')});
$('appSelect').addEventListener('change',e=>{state.appId=e.target.value;render()});
document.querySelectorAll('.nav').forEach(n=>n.addEventListener('click',()=>{state.section=n.dataset.section;render()}));
})();
</script></body></html>`;