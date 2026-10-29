import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseFm } from './content-tools.mjs';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const clean = (value, max = 1000) => typeof value === 'string' && value.length <= max ? value.trim() : fail('文字格式不正确或过长');
const normalized = value => clean(value, 1000).normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase();
const digest = (password, salt) => scryptSync(password, salt, 64).toString('hex');
const safeUser = user => ({ id: user.id, username: user.username, name: user.name, role: user.role, access: user.access, canCreate: user.canCreate, grants: [...(user.grants || [])], createdAt: user.createdAt, lastLogin: user.lastLogin || '' });

export function createCollaborationStore(root) {
  const directory = join(root, '.local-collaboration');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'archive.json');
  let state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {
    version: 1, answerKey: randomBytes(32).toString('hex'), users: [], entries: [], media: [],
    questions: [], threshold: 0, defaultAccess: 'selected', defaultCreate: false, history: [], audit: [],
  };
  function persist() {
    const temp = file + '.' + randomUUID() + '.tmp';
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    renameSync(temp, file);
  }
  // Roll back in-memory state too when disk persistence fails.
  function transaction(action) {
    const before = structuredClone(state);
    try { const result = action(); persist(); return result; } catch (error) { state = before; throw error; }
  }
  function audit(actor, action, target) { state.audit.push({ at: new Date().toISOString(), actor: actor?.id || '', action, target }); }
  function owner(user) { if (user?.role !== 'owner' || user.access === 'blocked') fail('仅站主可操作', 403); }
  function active(user) { if (!user || user.access === 'blocked') fail('账号未获准访问', 403); }
  function getUser(id) { return state.users.find(user => user.id === id); }
  function checkedUser(id) { const user = getUser(id); active(user); return user; }
  function passwordRecord(value) {
    const password = clean(value, 200);
    if (password.length < 12) fail('密码至少12个字符');
    const salt = randomBytes(16).toString('hex');
    return { salt, hash: digest(password, salt) };
  }
  function createUser(input, role) {
    const username = clean(input.username, 40).toLowerCase(), name = clean(input.name, 60);
    if (!/^[a-z0-9_-]{3,40}$/.test(username) || !name) fail('账号请用3—40位字母、数字、下划线；昵称不能为空');
    if (state.users.some(user => user.username === username)) fail('账号已存在');
    return { id: randomUUID(), username, name, password: passwordRecord(input.password), role,
      access: role === 'owner' ? 'all' : state.defaultAccess, canCreate: role === 'owner' || state.defaultCreate,
      createdAt: new Date().toISOString() };
  }
  const setupFile = join(directory, 'setup-token');
  if (!state.users.length && !existsSync(setupFile)) writeFileSync(setupFile, randomBytes(32).toString('hex'), { mode: 0o600 });
  function setup(input, token) {
    if (state.users.length) fail('站主账号已建立', 409);
    const expected = readFileSync(setupFile, 'utf8');
    if (typeof token !== 'string' || token.length !== expected.length || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) fail('初始化凭据不正确', 403);
    const user = transaction(() => {
      const user = createUser(input, 'owner'); state.users.push(user);
      importArchive(user); audit(user, 'setup', user.id); return safeUser(user);
    });
    rmSync(setupFile, { force: true });
    return user;
  }
  function importArchive(user) {
    for (const [folder, type] of [['events', 'event'], ['works', 'work'], ['associations', 'thought']]) {
      const base = join(root, 'src', 'content', folder);
      if (!existsSync(base)) continue;
      const walk = dir => readdirSync(dir, {withFileTypes:true}).flatMap(item => item.isDirectory() ? walk(join(dir,item.name)) : item.name.endsWith('.md') ? [join(dir,item.name)] : []);
      for (const path of walk(base)) {
        const data = parseFm(readFileSync(path, 'utf8'));
        state.entries.push({ id: randomUUID(), revision: randomUUID(), author: user.id, type,
          title: data.title || '未命名想法', date: data.date || '?', body: data.body?.trim() || data.summary || data.note || '',
          summary: data.summary || '', images: data.images || [], videos: data.videos || [], medium: data.medium || '',
          persons: data.persons || [], major: !!data.major, kind: data.kind || '', fromType: data.fromType || '', fromId: data.fromId || '',
          toType: data.toType || '', toId: data.toId || '', published: !data.draft,
          scope: data.draft ? 'private' : 'members', recipients: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          source: path.slice(base.length + 1).replaceAll('\\','/') });
      }
    }
    for(const entry of state.entries.filter(entry=>entry.type==='thought')){
      for(const prefix of ['from','to']){
        const target=state.entries.find(other=>other.type===entry[prefix+'Type']&&other.source?.split('/').at(-1)?.replace(/\.md$/,'')===entry[prefix+'Id']);
        entry[prefix+'Id']=target?.id||'';
      }
    }
  }
  function questionHash(value) { return createHmac('sha256', state.answerKey).update(normalized(value)).digest('hex'); }
  function questions() { return { ready: state.questions.length > 0, questions: state.questions.map(q => ({id:q.id,text:q.text})), threshold: state.threshold }; }
  function configure(user, input) {
    owner(user);
    if (!Array.isArray(input.questions) || input.questions.length < 1 || input.questions.length > 10) fail('请设置1—10道问题');
    return transaction(() => {
      state.questions = input.questions.map(q => {
        const text = clean(q.text, 500);
        if (!text || !Array.isArray(q.answers) || !q.answers.length || q.answers.length > 20 || q.answers.some(answer => !normalized(answer))) fail('每题需填写题目及至少一个可接受答案');
        return {id:randomUUID(),text,hashes:q.answers.map(questionHash)};
      });
      const threshold = Number(input.threshold);
      if (!Number.isInteger(threshold) || threshold < 1 || threshold > state.questions.length) fail('通过题数不正确');
      if (!['selected','all'].includes(input.defaultAccess)) fail('默认访问范围不正确');
      state.threshold = threshold; state.defaultAccess = input.defaultAccess; state.defaultCreate = input.defaultCreate === true;
      audit(user,'questions',''); return questions();
    });
  }
  function register(input) {
    if(input.consent!==true) fail('请先确认加入说明');
    if (!state.questions.length) fail('站主尚未开放问答入口', 403);
    const answers = input.answers || {};
    const correct = state.questions.filter(q => q.hashes.includes(questionHash(answers[q.id] || ''))).length;
    if (correct < state.threshold) fail('答案尚未达到通过条件');
    return transaction(() => {
      const user = createUser(input, 'member'); state.users.push(user);
      audit(user,'admitted',user.id); return safeUser(user);
    });
  }
  const dummySalt = randomBytes(16).toString('hex');
  function login(input) {
    const username = clean(input.username,40).toLowerCase();
    const user = state.users.find(user => user.username === username);
    const actual = digest(clean(input.password,200), user?.password.salt || dummySalt);
    const expected = user?.password.hash || '0'.repeat(128);
    if (!timingSafeEqual(Buffer.from(actual,'hex'),Buffer.from(expected,'hex')) || !user || user.access === 'blocked') fail('账号、密码不正确或账号已停用', 401);
    return transaction(() => { user.lastLogin = new Date().toISOString(); audit(user,'login',user.id); return safeUser(user); });
  }
  function canRead(user, entry) {
    if (!user || user.access === 'blocked' || entry.archived) return false;
    if(user.role==='guest')return entry.visitorVisible===true&&entry.published&&entry.scope==='members'&&['fromId','toId'].every(key=>!entry[key]||state.entries.some(target=>target.id===entry[key]&&target.type!=='thought'&&canRead(user,target)));
    if (user.role === 'owner' || entry.author === user.id) return true;
    if (!entry.published || entry.scope === 'private') return false;
    const shared=entry.scope==='selected'?entry.recipients.includes(user.id):entry.visitorVisible===true||user.access==='all'||(user.grants||[]).includes(entry.id);
    if(!shared)return false;
    return ['fromId','toId'].every(key=>!entry[key]||state.entries.some(target=>target.id===entry[key]&&target.type!=='thought'&&canRead(user,target)));
  }
  function entryView(user, entry) {
    return { ...entry, visitorVisible:entry.visitorVisible===true, authorName: getUser(entry.author)?.name || '原作者', editable: entry.author === user.id };
  }
  function changePassword(user,input) {
    active(user);
    const target=input.id?getUser(input.id):getUser(user.id);
    if(!target || (target.id!==user.id && user.role!=='owner') || (target.role==='owner'&&target.id!==user.id)) fail('无权更改此账号',403);
    if(target.id===user.id && !timingSafeEqual(Buffer.from(digest(clean(input.currentPassword,200),target.password.salt),'hex'),Buffer.from(target.password.hash,'hex'))) fail('当前密码不正确',403);
    return transaction(()=>{target.password=passwordRecord(input.password);audit(user,'password',target.id);return {ok:true,id:target.id};});
  }
  function entries(user) { active(user); return state.entries.filter(entry => canRead(user,entry)).map(entry => entryView(user,entry)); }
  function readEntry(user,id) {
    active(user); const entry = state.entries.find(entry => entry.id === id);
    if (!entry || !canRead(user,entry)) fail('记录不存在或无权查看',404);
    return entryView(user,entry);
  }
  function saveEntry(user,input) {
    active(user);
    const existing = input.id ? state.entries.find(entry => entry.id === input.id) : null;
    if (input.id && !existing) fail('记录不存在',404);
    if (existing && (existing.author !== user.id || existing.archived)) fail('只能修改自己的原文',403);
    if (!existing && !user.canCreate) fail('尚未获得投稿资格',403);
    if (existing && (!input.revision || input.revision !== existing.revision)) fail('记录已更新，请先保留当前文字再重新打开',409);
    const body = clean(input.body || '',200000);
    let title=clean(input.title||'',300);
    if (!title && input.type!=='thought') fail('请填写标题');
    if (!['event','work','thought'].includes(input.type) || !['private','members','selected'].includes(input.scope)) fail('类型或分享范围不正确');
    const fromId=input.type==='thought'?clean(input.fromId||'',100):'',toId=input.type==='thought'?clean(input.toId||'',100):'';
    if(input.type==='thought'&&!title){if(!body&&!(fromId&&toId))fail('先写下一点想法，或连接两段记录');title=body?body.replace(/\s+/g,' ').slice(0,30)+(body.length>30?'…':''):'一段联想';}
    for(const id of [fromId,toId].filter(Boolean))if(!state.entries.some(target=>target.id===id&&target.type!=='thought'&&canRead(user,target)))fail('关联记录不存在或无权阅读',403);
    const kind=input.type==='work'?clean(input.kind||'book',20):'';
    if(kind&&!['book','film','game'].includes(kind))fail('作品类型不正确');
    const recipients = [...new Set(Array.isArray(input.recipients) ? input.recipients : [])];
    if (recipients.some(id => !getUser(id))) fail('分享对象不存在');
    if(user.role==='owner'&&input.visitorVisible===true&&input.published===true&&input.scope==='members'&&[fromId,toId].some(id=>id&&!state.entries.some(target=>target.id===id&&canRead(guest(),target))))fail('请先向访客开放关联的记忆或作品，再开放这段想法');
    const images = Array.isArray(input.images) ? input.images.map(value => clean(value,2000)) : [];
    const videos = Array.isArray(input.videos) ? input.videos.map(value => clean(value,2000)) : [];
    const oldFiles = [...(existing?.images || []),...(existing?.videos || [])];
    for (const reference of [...images,...videos]) {
      const media = state.media.find(item => '/api/media/' + item.id === reference);
      if (!oldFiles.includes(reference) && (!media || media.owner !== user.id)) fail('只能附上自己上传的文件');
    }
    return transaction(() => {
      const now = new Date().toISOString();
      if (existing) state.history.push({ entry: structuredClone(existing), at:now, actor:user.id });
      const entry = { ...(existing || {}), id:existing?.id || randomUUID(), author:user.id, revision:randomUUID(), title, body,
        type:input.type, date:clean(input.date || '?',40), scope:input.scope, recipients,
        medium:clean(input.medium || '',300), persons:Array.isArray(input.persons)?input.persons.map(person=>clean(person,100)):[],major:input.major===true,
        fromId,toId,kind,
        visitorVisible:user.role==='owner'&&input.visitorVisible===true&&input.published===true&&input.scope==='members',
        published:input.published === true, images,videos, updatedAt:now,createdAt:existing?.createdAt || now };
      if (existing) state.entries[state.entries.indexOf(existing)] = entry; else state.entries.push(entry);
      audit(user,'save',entry.id); return entryView(user,entry);
    });
  }
  function members(user) { active(user); return state.users.filter(u => u.access !== 'blocked').map(u => user.role === 'owner' ? safeUser(u) : {id:u.id,name:u.name}); }
  function setVisitorAccess(user,input){
    owner(user);const entry=state.entries.find(entry=>entry.id===input.id&&!entry.archived);
    if(!entry)fail('记录不存在',404);
    if(input.revision!==entry.revision)fail('记录已更新，请刷新后再设置',409);
    if(input.visible===true&&(!entry.published||entry.scope!=='members'))fail('只有已发布的共同内容才能开放给访客；私人和定向内容不能直接对外开放');
    if(input.visible===true&&['fromId','toId'].some(key=>entry[key]&&!state.entries.some(target=>target.id===entry[key]&&canRead(guest(),target))))fail('请先向访客开放关联的记忆或作品，再开放这段想法');
    return transaction(()=>{state.history.push({entry:structuredClone(entry),at:new Date().toISOString(),actor:user.id});entry.visitorVisible=input.visible===true;entry.revision=randomUUID();audit(user,'visitor-access',entry.id);return entryView(user,entry);});
  }
  function updateMember(user,input) {
    owner(user);
    const target = getUser(input.id);
    if (!target || target.role === 'owner') fail('不能通过此处更改站主');
    if (!['selected','all','blocked'].includes(input.access)) fail('访问范围不正确');
    return transaction(() => {
      target.access=input.access; target.canCreate=input.canCreate===true;
      target.grants = Array.isArray(input.grants) ? [...new Set(input.grants)].filter(id => state.entries.some(e => e.id === id)) : [];
      audit(user,'member',target.id); return safeUser(target);
    });
  }
  function history(user,id) { readEntry(user,id); const entry=state.entries.find(e=>e.id===id); if(user.role!=='owner'&&entry.author!==user.id) fail('只有作者和站主能查看历史',403); return state.history.filter(h=>h.entry.id===id); }
  function archive(user,input) {
    active(user); const entry=state.entries.find(e=>e.id===input.id);
    if(!entry || (entry.author!==user.id&&user.role!=='owner')) fail('无权操作',403);
    if(entry.archived&&user.role!=='owner'&&entry.archivedBy!==user.id)fail('站主下架的记录只能由站主恢复',403);
    if(input.revision!==entry.revision) fail('版本已变化',409);
    return transaction(()=>{state.history.push({entry:structuredClone(entry),at:new Date().toISOString(),actor:user.id}); entry.archived=input.archived===true; entry.archivedBy=entry.archived?user.id:''; entry.revision=randomUUID(); audit(user,entry.archived?'archive':'restore',entry.id); return {ok:true};});
  }
  function mediaAdd(user,media) { active(user); if(!user.canCreate) fail('尚未获得投稿资格',403); return transaction(()=>{state.media.push({...media,owner:user.id}); audit(user,'upload',media.id); return media;}); }
  function mediaRead(user,id) {
    active(user); const item=state.media.find(m=>m.id===id);
    if(!item || !(user.role==='owner'||item.owner===user.id||state.entries.some(e=>canRead(user,e)&&[...e.images,...e.videos].includes('/api/media/'+id)))) fail('文件不存在或无权查看',404);
    return item;
  }
  function guest(){return {id:'__visitor__',role:'guest',access:'guest',canCreate:false,name:'访客'};}
  return { directory, setupFile, isSetup:()=>state.users.length>0, setup, questions, configure, register, login, checkedUser,
    profile:id=>safeUser(checkedUser(id)), entries, readEntry, saveEntry, members, updateMember, history, archive, mediaAdd, mediaRead, changePassword,setVisitorAccess,
    guest,
    ownerOverview(user){owner(user);return {members:state.users.map(safeUser),audit:state.audit.slice(-200).reverse(),archived:state.entries.filter(e=>e.archived),settings:{...questions(),defaultAccess:state.defaultAccess,defaultCreate:state.defaultCreate},notice:'站主可查看本机保存的全部记录，包括私人记录。'};},
  };
}
