// ===== Helpers =====
const { useEffect, useMemo, useState, useRef } = React;
const e = React.createElement;

const LS_KEY = 'agenda_estudiantes_sin_google_v5';
const TEACHER_LS_KEY = 'teacher_profile_v1';

function uid(prefix) { prefix = prefix || 'id'; return prefix + '_' + Math.random().toString(36).slice(2,9); }
function safeStats(stats) { return stats && typeof stats === 'object' ? stats : { present:0, absent:0, later:0 }; }
function pct(stats) { const s = safeStats(stats); const d = (s.present||0) + (s.absent||0); return d ? Math.round((s.present/d)*100) : 0; }
function todayStr(d=new Date()){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function avg(arr){
  if(!arr || !arr.length) return 0;
  const nums = arr.map(x => Number(x.value)).filter(v => !Number.isNaN(v));
  if(!nums.length) return 0;
  const s = nums.reduce((a,b)=>a+b,0);
  return Math.round((s/nums.length)*100)/100;
}
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const base = { courses:{}, selectedCourseId:null, selectedDate: todayStr() };
    if (!raw) return base;
    const parsed = JSON.parse(raw);
    return {
      courses: parsed.courses || {},
      selectedCourseId: parsed.selectedCourseId || null,
      selectedDate: todayStr()
    };
  } catch {
    return { courses:{}, selectedCourseId:null, selectedDate: todayStr() };
  }
}
function saveState(state){ localStorage.setItem(LS_KEY, JSON.stringify(state)); }

// Perfil de profe (dispositivo)
function loadTeacher(){
  try { return JSON.parse(localStorage.getItem(TEACHER_LS_KEY)) || { name:'', article:'la' }; }
  catch { return { name:'', article:'la' }; }
}
function saveTeacher(t){ localStorage.setItem(TEACHER_LS_KEY, JSON.stringify(t)); }

function sanitizePhone(phoneRaw=''){
  // Normaliza números de AR para WhatsApp (wa.me)
  let d = String(phoneRaw).replace(/\D+/g, '');
  if (!d) return '';
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1);
  d = d.replace(/^54(9?)(\d{2,4})15(\d{7,8})$/, '54$1$2$3');
  if (!d.startsWith('54') && d.length >= 10 && d.length <= 11) d = '54' + d;
  if (d.startsWith('54') && d[2] !== '9') d = '54' + '9' + d.slice(2);
  d = d.replace(/^549(\d{2,4})15(\d{7,8})$/, '549$1$2');
  return d;
}
function buildRiskMessage(course, student, attendancePct, promedio, teacher){
  const courseName = course?.name || 'curso';
  const pName = student?.name || '';
  const art = (teacher?.article || 'la').trim();
  const tName = (teacher?.name || '').trim();
  const saludo = tName ? `Hola, soy ${art} profe ${tName}.` : 'Hola, soy la profe.';
  const msg = `${saludo} Aviso de RIESGO para ${pName} (${courseName}). Asistencia: ${attendancePct}%. Promedio: ${promedio}.`;
  return encodeURIComponent(msg);
}


// ====== Auth helpers ======
const SESSION_KEY = 'session_user_v1';

function parseCSV(text){
  // Simple CSV parser (no quoted commas); fits our sheet
  const rows = text.trim().split(/\r?\n/);
  if(!rows.length) return [];
  // detect header
  const header = rows[0].split(',').map(h => h.trim().toLowerCase());
  const mapping = { usuario: header.indexOf('usuario'), contrasena: header.indexOf('contraseña'), correo: header.indexOf('correo') };
  const items = [];
  for (let i=1;i<rows.length;i++){
    const cols = rows[i].split(',').map(c => c.trim());
    const usuario = mapping.usuario>=0 ? cols[mapping.usuario] : cols[0];
    const contrasena = mapping.contrasena>=0 ? cols[mapping.contrasena] : cols[1];
    const correo = mapping.correo>=0 ? cols[mapping.correo] : cols[2] || '';
    items.push({ usuario, contrasena, correo });
  }
  return items;
}

async function fetchUsers(){
  const url = (window.USERS_CSV_URL || '').trim();
  if(!url) throw new Error('Falta USERS_CSV_URL');
  const res = await fetch(url + '&_=' + Date.now());
  if(!res.ok) throw new Error('No se pudo leer la hoja');
  const text = await res.text();
  return parseCSV(text);
}

function loadSession(){ try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || null; } catch { return null; } }
function saveSession(sess){ localStorage.setItem(SESSION_KEY, JSON.stringify(sess||null)); }
function clearSession(){ localStorage.removeItem(SESSION_KEY); }

function AdminMailLink(subject, body){
  const mail = (window.SUPPORT_EMAIL || 'admin@ejemplo.com').trim();
  const link = `mailto:${mail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = link;
}

// ====== Auth UI ======
function LoginScreen({ onLogin }){
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(ev){
    ev && ev.preventDefault();
    setError(''); setLoading(true);
    try {
      const users = await fetchUsers();
      const found = users.find(u => (u.usuario||'').toLowerCase() === (usuario||'').toLowerCase());
      if(!found){ setError('Usuario no encontrado.'); return; }
      if(String(found.contrasena||'') !== String(password||'')){ setError('Contraseña incorrecta.'); return; }
      saveSession({ usuario: found.usuario, correo: found.correo || '' });
      onLogin && onLogin();
    } catch(err){
      setError(err && err.message ? err.message : 'Error cargando usuarios.');
    } finally {
      setLoading(false);
    }
  }

  function forgotPassword(){
    const api = (window.PASSWORD_API_URL || '').trim();
    if(api){
      const correo = prompt('Ingresá tu correo (para enviarte un código):') || '';
      if(!correo) return;
      fetch(api, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({ action:'recover', usuario, correo }).toString() })
        .then(async r => { try{ const j = await r.json(); if(j.status==='ok'){ alert('Listo: revisá tu correo / nueva clave enviada.'); } else { alert('No se pudo procesar: ' + (j.message||'error')); } } catch(_){ alert('Pedido enviado. Si es correcto, recibirás instrucciones.'); } })
        .catch(()=> alert('No se pudo contactar al servidor.'));
    } else {
      AdminMailLink('Recuperar contraseña', `Usuario: ${usuario}\nCorreo: (completá aquí)\n\nSolicito recuperar la contraseña.`);
    }
  }

  function changePassword(){
    const api = (window.PASSWORD_API_URL || '').trim();
    if(api){
      const actual = prompt('Tu contraseña actual:') || '';
      const nueva = prompt('Nueva contraseña:') || '';
      if(!nueva) return;
      fetch(api, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({ action:'change', usuario, password_actual: actual, password_nueva: nueva }).toString() })
        .then(async r => { try{ const j = await r.json(); if(j.status==='ok'){ alert('Contraseña cambiada. Volvé a iniciar sesión.'); clearSession(); location.reload(); } else { alert('No se pudo cambiar: ' + (j.message||'error')); } } catch(_){ alert('Solicitud enviada. Si es correcta, se aplicará el cambio.'); } })
        .catch(()=> alert('No se pudo contactar al servidor.'));
    } else {
      AdminMailLink('Cambiar contraseña', `Usuario: ${usuario}\n\nSolicito cambiar mi contraseña.`);
    }
  }

  return e('div', { className:'min-h-dvh flex items-center justify-center p-6' },
    e('div', { className:'w-full max-w-sm bg-white rounded-3xl border shadow p-6', style:{ borderColor:'#d7dbe0' } },
      e('div', { className:'text-center mb-4' },
        e('div', { className:'text-2xl font-bold', style:{ color:'#24496e' } }, 'Tomador de lista'),
        e('div', { className:'text-sm text-slate-600' }, 'Ingresá con tu usuario')
      ),
      e('form', { onSubmit:submit, className:'space-y-3' },
        e('div', null,
          e('label', { className:'block text-sm mb-1', style:{color:'#24496e'} }, 'Usuario'),
          e('input', { value:usuario, onChange:e=>setUsuario(e.target.value), className:'w-full px-3 py-2 border rounded-xl', style:{borderColor:'#d7dbe0'}, autoFocus:true })
        ),
        e('div', null,
          e('label', { className:'block text-sm mb-1', style:{color:'#24496e'} }, 'Contraseña'),
          e('input', { type:'password', value:password, onChange:e=>setPassword(e.target.value), className:'w-full px-3 py-2 border rounded-xl', style:{borderColor:'#d7dbe0'} })
        ),
        error ? e('div', { className:'text-sm text-red-700 bg-red-50 rounded px-2 py-1' }, error) : null,
        e('button', { type:'submit', disabled:loading, className:'w-full px-4 py-2 rounded-2xl text-white font-semibold', style:{ background:'#6c467e', opacity: loading? .7:1 } }, loading ? 'Ingresando...' : 'Ingresar'),
        e('div', { className:'flex items-center justify-between text-sm pt-1' },
          e('button', { type:'button', onClick:forgotPassword, className:'underline', style:{color:'#24496e'} }, 'Olvidé mi contraseña'),
          e('button', { type:'button', onClick:changePassword, className:'underline', style:{color:'#24496e'} }, 'Cambiar contraseña')
        )
      )
    )
  );
}


function ChangePasswordPanel({ usuario, onClose }){
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repite, setRepite] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit(ev){
    ev && ev.preventDefault();
    setMsg(''); 
    if(!nueva || nueva !== repite){ setMsg('La nueva contraseña no coincide.'); return; }
    const api = (window.PASSWORD_API_URL || '').trim();
    if(!api){ setMsg('PASSWORD_API_URL no está configurada.'); return; }
    setLoading(true);
    try {
      const body = new URLSearchParams({ action:'change', usuario, password_actual: actual, password_nueva: nueva }).toString();
      const r = await fetch(api, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body });
      let ok = false, err='';
      try { const j = await r.json(); ok = (j.status==='ok'); err = j.message||''; } catch(_){ ok = r.ok; }
      if(ok){
        setMsg('¡Contraseña actualizada! Cerrando…');
        setTimeout(()=>{ onClose && onClose(); alert('Volvé a iniciar sesión con tu nueva contraseña.'); clearSession(); location.reload(); }, 800);
      } else {
        setMsg('No se pudo cambiar: ' + (err||'error'));
      }
    } catch(e){ setMsg('Error de red.'); }
    finally{ setLoading(false); }
  }

  return e('div', { className:'fixed inset-0 bg-black/30 flex items-center justify-center p-4', role:'dialog' },
    e('div', { className:'w-full max-w-sm bg-white rounded-3xl p-5 shadow' },
      e('div', { className:'text-lg font-semibold mb-2', style:{color:'#24496e'} }, 'Cambiar contraseña'),
      e('form', { onSubmit:submit, className:'space-y-3' },
        e('div', null,
          e('label', { className:'block text-sm mb-1' }, 'Contraseña actual'),
          e('input', { type:'password', value:actual, onChange:e=>setActual(e.target.value), className:'w-full px-3 py-2 border rounded-xl', style:{borderColor:'#d7dbe0'} })
        ),
        e('div', null,
          e('label', { className:'block text-sm mb-1' }, 'Nueva contraseña'),
          e('input', { type:'password', value:nueva, onChange:e=>setNueva(e.target.value), className:'w-full px-3 py-2 border rounded-xl', style:{borderColor:'#d7dbe0'} })
        ),
        e('div', null,
          e('label', { className:'block text-sm mb-1' }, 'Repetir nueva contraseña'),
          e('input', { type:'password', value:repite, onChange:e=>setRepite(e.target.value), className:'w-full px-3 py-2 border rounded-xl', style:{borderColor:'#d7dbe0'} })
        ),
        msg ? e('div', { className:'text-sm', style:{color: msg.startsWith('¡')?'#2b647b':'#b91c1c'} }, msg) : null,
        e('div', { className:'flex gap-2 justify-end' },
          e('button', { type:'button', onClick:onClose, className:'px-3 py-2 rounded-xl', style:{background:'#f3efdc', color:'#24496e'} }, 'Cancelar'),
          e('button', { type:'submit', disabled:loading, className:'px-3 py-2 rounded-xl text-white', style:{background:'#6c467e', opacity: loading? .7:1} }, loading ? 'Guardando…' : 'Guardar')
        )
      )
    )
  );
}

function AppShell(){
  const [sess, setSess] = useState(loadSession());
  function handleLogout(){ clearSession(); setSess(null); }
  function handleLogged(){ setSess(loadSession()); }
  return sess
    ? e('div', null,
        e('div', { className:'w-full flex justify-end p-2 text-sm' },
          e('div', { className:'flex items-center gap-2 text-slate-700' },
            e('span', null, sess.usuario || ''),
            e('button', { onClick:handleLogout, className:'px-2 py-1 rounded', style:{ background:'#f3efdc', color:'#24496e' } }, 'Cerrar sesión')
          )
        ),
        e(App, { session: sess })
      )
    : e(LoginScreen, { onLogin: handleLogged });
}


// ===== UI =====

function Header({ selectedDate, onChangeDate }) {
  return e('header',
    { className: 'w-full p-4 md:p-6 text-white flex items-center justify-between sticky top-0 z-10 shadow',
      style:{ background:'#24496e' } },
    e('div', { className:'flex flex-col gap-1' },
      e('div', { className:'flex items-center gap-3' },
        e('span', { className:'text-2xl md:text-3xl font-bold tracking-tight' }, 'Asistencia de Estudiantes')
      ),
      e('a', { href:'https://www.instagram.com/docentesbrown', target:'_blank', rel:'noopener',
               className:'text-xs md:text-sm underline', style:{ opacity:.9 } }, 'creado por @docentesbrown')
    ),
    e('div', { className:'flex items-center gap-2' },
      e('label', { className:'text-sm opacity-90 hidden md:block' }, 'Fecha:'),
      e('input', { type:'date', value:selectedDate,
        onChange:(ev)=>onChangeDate(ev.target.value),
        className:'rounded-md px-2 py-1 text-sm', style:{ color:'#24496e' } })
    )
  );
}

function EmptyState({ onCreateCourse }) {
  return e('div', { className:'p-6 md:p-10 text-center' },
    e('h2', { className:'text-xl md:text-2xl font-semibold mb-2', style:{ color:'#24496e' } }, 'No hay cursos aún'),
    e('p', { className:'text-slate-700 mb-4' }, 'Creá tu primer curso para comenzar.'),
    e('button', { onClick:onCreateCourse, className:'px-4 py-2 rounded-2xl text-white shadow', style:{ background:'#6c467e' } }, '+ Nuevo curso')
  );
}

function CoursesBar({ courses, selectedCourseId, onSelect, onCreate, onRename, onDelete }) {
  const [renamingId, setRenamingId] = useState(null);
  const [newName, setNewName]   = useState('');
  return e('div', { className:'w-full overflow-x-auto border-b border-slate-300 bg-white' },
    e('div', { className:'flex items-center gap-2 p-3 min-w-max' },
      ...Object.values(courses).map((c) =>
        e('div', { key:c.id, className:'flex items-center gap-2 px-3 py-2 rounded-2xl border',
          style: selectedCourseId===c.id ? { borderColor:'#24496e', background:'#f0f4f8' } : { borderColor:'#d7dbe0' } },
          renamingId===c.id
            ? e('input', { autoFocus:true, value:newName, onChange:(ev)=>setNewName(ev.target.value),
                onBlur:()=>{ onRename(c.id, newName || c.name); setRenamingId(null); },
                onKeyDown:(ev)=>{ if(ev.key==='Enter'){ onRename(c.id, newName||c.name); setRenamingId(null); } if(ev.key==='Escape'){ setRenamingId(null); } },
                className:'px-2 py-1 text-sm border rounded', style:{ borderColor:'#d7dbe0' } })
            : e('button', { className:'text-sm font-medium', style:{ color: selectedCourseId===c.id ? '#24496e' : '#334155' }, onClick:()=>onSelect(c.id) }, c.name),
          e('div', { className:'flex items-center gap-1' },
            e('button', { title:'Renombrar', onClick:()=>{ setRenamingId(c.id); setNewName(c.name); },
              className:'text-xs px-2 py-1 rounded', style:{ background:'#f3efdc', color:'#24496e' } }, '✎'),
            e('button', { title:'Eliminar curso', onClick:()=>onDelete(c.id),
              className:'text-xs px-2 py-1 rounded', style:{ background:'#fde2e0', color:'#da6863' } }, '🗑')
          )
        )
      ),
      e('button', { onClick:onCreate, className:'px-3 py-2 rounded-2xl text-sm', style:{ background:'#f3efdc', color:'#24496e' } }, '+ Nuevo curso')
    )
  );
}

function StudentsTable({ course, students, onAdd, onEdit, onDelete, onShowAbsences, onOpenGrades, onNotifyPreceptor }) {
  const [cond, setCond] = useState('cursa');
  const [name, setName] = useState('');
  const sorted = useMemo(() => Object.values(students).sort((a,b)=>a.name.localeCompare(b.name)), [students]);
  return e('div', { className:'p-4 md:p-6' },
    e('div', { className:'flex flex-col md:flex-row gap-2 md:items-end mb-4' },
      e('div', { className:'flex-1' },
        e('label', { className:'block text-sm font-medium mb-1', style:{ color:'#24496e' } }, 'Agregar estudiante'),
        e('input', { placeholder:'Nombre y apellido', value:name, onChange:(ev)=>setName(ev.target.value),
          className:'w-full max-w-md px-3 py-2 border rounded-xl', style:{ borderColor:'#d7dbe0' } })
      ),
      e('div', { className:'flex items-center gap-2' },
        e('select', { value:cond, onChange:(ev)=>setCond(ev.target.value), className:'px-3 py-2 border rounded-xl', style:{ borderColor:'#d7dbe0' } },
          e('option', {value:'cursa'}, 'Cursa'),
          e('option', {value:'recursa'}, 'Recursa')
        )
      ),
      e('button', { onClick:()=>{ if(!name.trim()) return; onAdd(name.trim(), cond); setName(''); },
        className:'px-4 py-2 rounded-xl text-white', style:{ background:'#6c467e' } }, '+ Agregar')
    ),
    e('div', { className:'overflow-x-auto' },
      e('table', { className:'w-full text-left border rounded-xl overflow-hidden', style:{ borderColor:'#cbd5e1' } },
        e('thead', { style:{ background:'#24496e', color:'#ffffff' } },
          e('tr', null,
            e('th', { className:'p-3 text-sm' }, 'Estudiante'),
            e('th', { className:'p-3 text-sm' }, '% Asistencia'),
            e('th', { className:'p-3 text-sm' }, 'Presente'),
            e('th', { className:'p-3 text-sm' }, 'Ausente'),
            e('th', { className:'p-3 text-sm' }, 'Promedio'),
            e('th', { className:'p-3 text-sm' }),             // columna de riesgo (opcional)
            e('th', { className:'p-3 text-sm' }, 'Notas')     // título pedido
          )
        ),
        e('tbody', null,
          ...(sorted.length
            ? sorted.map((s, idx) => {
                const st = safeStats(s.stats);
                const rowBg = idx % 2 === 0 ? '#ffffff' : '#f3efdc';
                const promedio = avg(s.grades||[]);
                const attendancePct = pct(st);
                const isLowAttendance = attendancePct < 15;
                const isRisk = attendancePct < 85 && promedio < 7;
                return e('tr', { key:s.id, style:{ background:rowBg, borderTop:'1px solid #cbd5e1' } },
                  e('td', { className:'p-3' },
                    e('div', { className:'flex items-center gap-2' },
                      e('span', { className:'font-medium' }, s.name),
                      (s.condition ? e('span', { className:'text-[10px] px-2 py-0.5 rounded-full',
                        style:{ background: s.condition==='recursa' ? '#fde2e0' : '#e8f7ef', color: s.condition==='recursa' ? '#da6863' : '#166534' } },
                        s.condition==='recursa' ? 'Recursa' : 'Cursa') : null),
                      e('button', { onClick:()=>{
                          const nuevo = prompt('Editar nombre', s.name) || s.name;
                          const cond = prompt('Condición (cursa/recursa)', s.condition || 'cursa') || (s.condition || 'cursa');
                          const norm = (cond||'').toLowerCase()==='recursa' ? 'recursa' : 'cursa';
                          onEdit(s.id, { name: nuevo.trim(), condition: norm });
                        },
                        className:'text-xs px-2 py-1 rounded', style:{ background:'#f3efdc', color:'#24496e' } }, 'Editar')
                    )
                  ),
                  e('td', { className:'p-3 font-semibold',
                    style: isLowAttendance
                      ? { background:'#fdecea', color:'#991b1b', borderRadius:'8px' }
                      : { color:'#24496e' } }, attendancePct + '%'),
                  e('td', { className:'p-3' }, st.present || 0),
                  e('td', { className:'p-3' },
                    e('div', { className:'flex items-center gap-2' },
                      e('span', null, st.absent || 0),
                      e('button', { onClick:()=>onShowAbsences(s), className:'text-xs px-2 py-1 rounded',
                        style:{ background:'#f3efdc', color:'#24496e' } }, 'Fechas')
                    )
                  ),
                  e('td', { className:'p-3 font-semibold', style:{ color:'#24496e' } }, promedio.toFixed(2)),
                  e('td', { className:'p-3' },
                    isRisk
                      ? e('div', { className:'flex items-center gap-2' },
                          e('span', { className:'text-[11px] font-semibold', style:{ color:'#991b1b' } }, 'Riesgo Pedagógico'),
                          (course?.preceptor?.phone
                            ? e('button', {
                                className:'text-xs px-2 py-1 rounded',
                                style:{ background:'#f0eaf5', color:'#6c467e' },
                                onClick:()=>onNotifyPreceptor(s, attendancePct, promedio)
                              }, 'Avisar')
                            : null)
                        )
                      : null
                  ),
                  e('td', { className:'p-3 text-right' },
                    e('div', {className:'flex gap-2 justify-end'},
                      e('button', { onClick:()=>onOpenGrades(s), className:'text-xs px-3 py-1 rounded',
                        style:{ background:'#f0eaf5', color:'#6c467e' } }, 'Notas'),
                      e('button', { onClick:()=>{ if(confirm('¿Eliminar estudiante y sus datos?')) onDelete(s.id); },
                        className:'text-xs px-3 py-1 rounded', style:{ background:'#fde2e0', color:'#da6863' } }, 'Eliminar')
                    )
                  )
                );
              })
            : [e('tr', { key:'empty' }, e('td', { colSpan:7, className:'p-4 text-center text-slate-500' }, 'Sin estudiantes.'))]
          )
        )
      )
    )
  );
}

function RollCallCard({ students, onMark, onUndo, selectedDate }) {
  const [order, setOrder] = useState(students.map(s => s.id));
  const [index, setIndex] = useState(0);
  const [ops, setOps] = useState([]);

  useEffect(() => { setOrder(students.map(s => s.id)); setIndex(0); setOps([]); }, [students.map(s => s.id).join('|')]);

  const currentId = order[index];
  const current = students.find(s => s.id === currentId) || null;

  function handleAction(action){
    if(!current) return;
    onMark(current.id, action, selectedDate);
    if (action === 'later') {
      const from = index;
      const newOrder = order.slice();
      const [m] = newOrder.splice(from, 1);
      newOrder.push(m);
      setOrder(newOrder);
      setOps(ops => ops.concat([{ id: current.id, action, type:'mark', fromIndex: from, toIndex: newOrder.length - 1 }]));
      return;
    }
    const from = index;
    setOps(ops => ops.concat([{ id: current.id, action, type:'mark', fromIndex: from, toIndex: from }]));
    setIndex(i => Math.min(i + 1, order.length));
  }

  function goBack(){
    if (ops.length === 0) return;
    const last = ops[ops.length - 1];
    onUndo(last.id, last.action, selectedDate);
    if (last.action === 'later' && typeof last.fromIndex === 'number' && typeof last.toIndex === 'number') {
      const newOrder = order.slice();
      const [m] = newOrder.splice(last.toIndex, 1);
      newOrder.splice(last.fromIndex, 0, m);
      setOrder(newOrder);
      setIndex(last.fromIndex);
    } else {
      setIndex(i => Math.max(0, i - 1));
    }
    setOps(arr => arr.slice(0, -1));
  }

  if (!students.length) return e('div', { className:'p-6 text-center text-slate-600' }, 'No hay estudiantes en este curso.');

  const cardPos = Math.min(index + 1, order.length);
  return e('div', { className:'p-4 md:p-6' },
    e('div', { className:'max-w-xl mx-auto' },
      e('div', { className:'mb-3 text-sm text-slate-600 text-center' }, `Tarjeta ${cardPos} / ${order.length}`),
      current
        ? e('div', { className:'rounded-3xl border shadow p-6 md:p-8 bg-white', style:{ borderColor:'#d7dbe0' } },
            e('div', { className:'text-center mb-6' },
              e('div', { className:'text-2xl md:4xl font-bold tracking-tight mb-2', style:{ color:'#24496e' } }, current.name),
              e('div', { className:'text-sm md:text-base text-slate-700' }, 'Asistencia acumulada: ',
                e('span', { className:'font-semibold', style:{ color:'#24496e' } }, pct(current.stats) + '%'),
                ' · Fecha sesión: ', e('span', { className:'font-semibold', style:{ color:'#24496e' } }, selectedDate)
              )
            ),
            e('div', { className:'grid grid-cols-2 gap-3 md:gap-4' },
              e('button', { onClick:()=>handleAction('present'), className:'py-3 md:py-4 rounded-2xl font-semibold border',
                style:{ background:'#e8f7ef', borderColor:'#cdebdc', color:'#166534' } }, 'Presente ✅'),
              e('button', { onClick:()=>handleAction('absent'), className:'py-3 md:py-4 rounded-2xl font-semibold border',
                style:{ background:'#fdecea', borderColor:'#f7d7d3', color:'#991b1b' } }, 'Ausente ❌'),
              e('button', { onClick:()=>handleAction('later'), className:'py-3 md:py-4 rounded-2xl font-semibold border col-span-2',
                style:{ background:'#f0eaf5', borderColor:'#e2d7ec', color:'#6c467e' } }, 'Revisar más tarde ⏳'),
              e('button', { onClick:goBack, className:'py-2 md:py-2.5 rounded-xl font-medium col-span-2',
                style:{ background:'#f3efdc', color:'#24496e' } }, '← Volver al anterior (deshacer)')
            )
          )
        : e('div', { className:'rounded-3xl border shadow p-6 md:p-8 bg-white text-center', style:{ borderColor:'#d7dbe0' } },
            e('div', { className:'text-xl font-semibold mb-2', style:{ color:'#24496e' } }, '¡Lista completada!'),
            e('div', { className:'text-slate-700' }, 'Ya asignaste estado a todos.')
          )
    )
  );
}

// Modal base
function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return e('div', { className:'fixed inset-0 z-50 flex items-end sm:items-center justify-center' },
    e('div', { className:'absolute inset-0', onClick:onClose, style:{ background:'rgba(0,0,0,.4)' } }),
    e('div', { className:'relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-lg p-4 sm:p-6 m-0 sm:m-4', style:{ background:'#ffffff', border:'1px solid #d7dbe0' } },
      e('div', { className:'flex items-center justify-between mb-3' },
        e('h3', { className:'text-lg font-semibold', style:{ color:'#24496e' } }, title),
        e('button', { onClick:onClose, className:'px-2 py-1 rounded', style:{ background:'#f3efdc', color:'#24496e' } }, '✕')
      ),
      e('div', null, children)
    )
  );
}

// Modal de calificaciones
function GradesModal({ open, student, onClose, onAdd, onEdit, onDelete }) {
  const [tipo, setTipo] = useState('escrito');
  const [date, setDate] = useState(todayStr());
  const [value, setValue] = useState('');
  useEffect(() => { if (open) { setTipo('escrito'); setDate(todayStr()); setValue(''); } }, [open]);
  if(!open || !student) return null;

  const grades = (student.grades||[]).slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const promedio = avg(grades);

  return e(Modal, { open, title:`Calificaciones – ${student.name}`, onClose },
    e('div', { className:'space-y-4' },
      e('div', { className:'grid grid-cols-1 sm:grid-cols-3 gap-2' },
        e('input', { type:'date', className:'px-3 py-2 border rounded-xl', style:{borderColor:'#d7dbe0'},
          value:date, onChange:(ev)=>setDate(ev.target.value)}),
        e('select', { value:tipo, onChange:(ev)=>setTipo(ev.target.value), className:'px-3 py-2 border rounded-xl', style:{borderColor:'#d7dbe0'} },
          e('option', {value:'escrito'}, 'Escrito'),
          e('option', {value:'oral'}, 'Oral'),
          e('option', {value:'practico'}, 'Práctico'),
          e('option', {value:'conceptual'}, 'Conceptual')
        ),
        e('input', { type:'number', step:'0.01', className:'px-3 py-2 border rounded-xl', style:{borderColor:'#d7dbe0'},
          placeholder:'Nota', value:value, onChange:(ev)=>setValue(ev.target.value)}),
      ),
      e('div', null,
        e('button', { onClick:()=>{
            const v = Number(value);
            if(Number.isNaN(v)) { alert('Ingresá una nota numérica.'); return; }
            onAdd({ id: uid('nota'), tipo, date: date || todayStr(), value: v });
            setValue('');
          },
          className:'px-4 py-2 rounded-xl text-white', style:{background:'#6c467e'}
        }, '+ Agregar nota')
      ),
      e('div', { className:'text-sm text-slate-700' }, `Promedio: `, e('strong', {style:{color:'#24496e'}}, promedio.toFixed(2))),
      e('div', { className:'max-h-64 overflow-auto border rounded-xl', style:{borderColor:'#d7dbe0'} },
        e('table', { className:'w-full text-left' },
          e('thead', { style:{background:'#24496e', color:'#fff'} },
            e('tr', null,
              e('th', {className:'p-2 text-sm'}, 'Fecha'),
              e('th', {className:'p-2 text-sm'}, 'Tipo'),
              e('th', {className:'p-2 text-sm'}, 'Nota'),
              e('th', {className:'p-2 text-sm'})
            )
          ),
          e('tbody', null,
            ...(grades.length ? grades.map(g =>
              e('tr', {key:g.id, className:'border-t', style:{borderColor:'#e2e8f0'}},
                e('td', {className:'p-2'}, g.date || ''),
                e('td', {className:'p-2'}, (g.tipo ? (g.tipo.charAt(0).toUpperCase()+g.tipo.slice(1)) : '')),
                e('td', {className:'p-2'}, String(g.value)),
                e('td', {className:'p-2 text-right'},
                  e('button', { className:'text-xs px-2 py-1 rounded mr-2', style:{background:'#f3efdc', color:'#24496e'},
                    onClick:()=>{
                      const newDate = prompt('Editar fecha (YYYY-MM-DD)', g.date || todayStr()) ?? g.date;
                      const newTipo = prompt('Editar tipo (escrito/oral/practico/conceptual)', g.tipo || 'escrito') ?? g.tipo;
                      const newValueRaw = prompt('Editar nota', String(g.value));
                      const nv = Number(newValueRaw);
                      if(Number.isNaN(nv)) return;
                      onEdit({ ...g, date:newDate, tipo:newTipo, value:nv });
                    }
                  }, 'Editar'),
                  e('button', { className:'text-xs px-2 py-1 rounded', style:{background:'#fde2e0', color:'#da6863'},
                    onClick:()=>onDelete(g.id)
                  }, 'Eliminar')
                )
              )
            ) : [e('tr', {key:'empty'}, e('td', {colSpan:4, className:'p-2 text-center text-slate-500'}, 'Sin notas todavía.'))])
          )
        )
      )
    )
  );
}

// Modal de inasistencias
function AbsencesModal({ open, student, onClose, onApplyChange }) {
  const [choices, setChoices] = useState({}); // histId -> reason
  useEffect(()=>{ setChoices({}); }, [open, student && student.id]);

  if(!open || !student) return null;
  const history = (student.history || []).map(h => h.id ? h : Object.assign({}, h, { id: uid('hist') }));
  const rows = history
    .filter(h => h.status === 'absent' || h.status === 'tarde')
    .slice()
    .sort((a,b)=>(a.date||'').localeCompare(b.date||''));

  const totalAusentes = rows.filter(r => r.status === 'absent').length;

  function labelFor(r){
    if(r.status === 'tarde') return 'Tarde';
    if(r.status === 'absent' && r.reason === 'justificada') return 'Justificada';
    return 'Ausente';
    }

  return e(Modal, { open, title:`Inasistencias – ${student.name}`, onClose },
    e('div', null,
      e('div', { className:'mb-3 text-sm text-slate-700' },
        'Total de ausencias: ',
        e('strong', {style:{color:'#24496e'}}, totalAusentes)
      ),
      e('div', { className:'max-h-72 overflow-auto border rounded-xl', style:{borderColor:'#d7dbe0'} },
        e('table', { className:'w-full text-left' },
          e('thead', { style:{background:'#24496e', color:'#fff'} },
            e('tr', null,
              e('th', {className:'p-2 text-sm'}, 'Fecha'),
              e('th', {className:'p-2 text-sm'}, 'Estado'),
              e('th', {className:'p-2 text-sm'}, 'Cambiar a'),
              e('th', {className:'p-2 text-sm'})
            )
          ),
          e('tbody', null,
            ...(rows.length ? rows.map((r) =>
              e('tr', { key:r.id, className:'border-t', style:{borderColor:'#e2e8f0'} },
                e('td', { className:'p-2' }, r.date || ''),
                e('td', { className:'p-2' }, labelFor(r)),
                e('td', { className:'p-2' },
                  e('select', {
                    className:'px-2 py-1 border rounded', style:{borderColor:'#d7dbe0'},
                    value:choices[r.id] || '',
                    onChange:(ev)=> setChoices(ch => Object.assign({}, ch, { [r.id]: ev.target.value }))
                  },
                    e('option', {value:''}, 'Seleccionar...'),
                    e('option', {value:'tarde'}, 'Tarde'),
                    e('option', {value:'justificada'}, 'Justificada'),
                    e('option', {value:'erronea'}, 'Errónea (eliminar)')
                  )
                ),
                e('td', { className:'p-2 text-right' },
                  e('button', {
                    className:'text-xs px-2 py-1 rounded',
                    style:{background:'#fde2e0', color:'#da6863'},
                    onClick:()=>{
                      const ch = choices[r.id];
                      if(!ch){ alert('Elegí una opción en "Cambiar a".'); return; }
                      onApplyChange(r.id, ch);
                    }
                  }, 'Aplicar')
                )
              )
            ) : [e('tr', { key:'empty' }, e('td', { colSpan:4, className:'p-2 text-center text-slate-500' }, 'Sin registros.'))])
          )
        )
      )
    )
  );
}

// Modal de Exportar/Importar
function ExportModal({ open, onClose, onExportJSON, onImportJSON, onExportXLSX }){
  const fileRef = useRef(null);
  function handleFile(ev){
    const file = ev.target.files && ev.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => { try { onImportJSON(reader.result); } finally { ev.target.value=''; } };
    reader.readAsText(file);
  }
  if(!open) return null;
  return e(Modal, { open, title:'Exportar / Importar', onClose },
    e('div', { className:'grid grid-cols-1 gap-3' },
      e('button', { onClick:onExportXLSX, className:'px-4 py-2 rounded-xl text-white font-semibold', style:{ background:'#24496e' } }, 'Exportar .xlsx'),
      e('button', { onClick:onExportJSON, className:'px-4 py-2 rounded-xl font-semibold', style:{ background:'#f3efdc', color:'#24496e' } }, 'Exportar a PC (.json)'),
      e('button', { onClick:()=> (fileRef.current && fileRef.current.click()), className:'px-4 py-2 rounded-xl font-semibold', style:{ background:'#f3efdc', color:'#24496e' } }, 'Importar desde PC (.json)'),
      e('input', { ref:fileRef, type:'file', accept:'.json,application/json', className:'hidden', onChange:handleFile })
    )
  );
}

// Modal de nuevo curso
function NewCourseModal({ open, onClose, onCreate }){
  const [name, setName] = useState('');
  const [days, setDays] = useState({ lun:false, mar:false, mie:false, jue:false, vie:false, sab:false });
  const [preceptorName, setPreceptorName] = useState('');
  const [preceptorPhone, setPreceptorPhone] = useState('');
  function toggleDay(k){ setDays(d => Object.assign({}, d, { [k]: !d[k] })); }
  function submit(){
    if(!name.trim()) { alert('Poné un nombre para el curso.'); return; }
    const selectedDays = Object.entries(days).filter(([k,v])=>v).map(([k])=>k);
    onCreate({
      name: name.trim(),
      days: selectedDays,
      preceptor: { name: preceptorName.trim(), phone: sanitizePhone(preceptorPhone) }
    });
    setName(''); setDays({ lun:false, mar:false, mie:false, jue:false, vie:false, sab:false });
    setPreceptorName(''); setPreceptorPhone('');
    onClose();
  }
  if(!open) return null;
  return e(Modal, { open, title:'Nuevo curso', onClose },
    e('div', { className:'space-y-4' },
      e('div', null,
        e('label', { className:'block text-sm font-medium mb-1', style:{ color:'#24496e' } }, 'Nombre del curso'),
        e('input', { value:name, onChange:ev=>setName(ev.target.value), className:'w-full px-3 py-2 border rounded-xl', style:{ borderColor:'#d7dbe0' }, placeholder:'3°B - Matemática' })
      ),
      e('div', null,
        e('div', { className:'block text-sm font-medium mb-1', style:{ color:'#24496e' } }, 'Días del curso'),
        e('div', { className:'grid grid-cols-3 gap-2' },
          ...[
            ['lun','Lunes'], ['mar','Martes'], ['mie','Miércoles'], ['jue','Jueves'], ['vie','Viernes'], ['sab','Sábado']
          ].map(([k,lab]) =>
            e('label', { key:k, className:'flex items-center gap-2 text-sm' },
              e('input', { type:'checkbox', checked:days[k], onChange:()=>toggleDay(k) }),
              e('span', null, lab)
            )
          )
        )
      ),
      e('div', null,
        e('div', { className:'block text-sm font-medium mb-1', style:{ color:'#24496e' } }, 'Preceptor/a'),
        e('div', { className:'grid grid-cols-1 sm:grid-cols-2 gap-2' },
          e('input', { value:preceptorName, onChange:ev=>setPreceptorName(ev.target.value), className:'px-3 py-2 border rounded-xl', style:{ borderColor:'#d7dbe0' }, placeholder:'Nombre' }),
          e('input', { value:preceptorPhone, onChange:ev=>setPreceptorPhone(ev.target.value), className:'px-3 py-2 border rounded-xl', style:{ borderColor:'#d7dbe0' }, placeholder:'Teléfono (WhatsApp)' })
        )
      ),
      e('div', null,
        e('button', { onClick:submit, className:'px-4 py-2 rounded-xl text-white font-semibold', style:{ background:'#6c467e' } }, 'Crear curso')
      )
    )
  );
}

// Modal Perfil del/la profe
function TeacherProfileModal({ open, onClose, onSave, initial }){
  const [name, setName] = React.useState(initial?.name || '');
  const [article, setArticle] = React.useState(initial?.article || 'la');
  useEffect(() => { if(open){ setName(initial?.name || ''); setArticle(initial?.article || 'la'); } }, [open]);
  if(!open) return null;
  return e(Modal, { open, title:'Tu perfil de profe', onClose },
    e('div', { className:'space-y-4' },
      e('p', { className:'text-sm text-slate-700' }, 'Usamos estos datos cuando se envía el aviso por WhatsApp al/la preceptor/a.'),
      e('div', null,
        e('label', { className:'block text-sm font-medium mb-1', style:{ color:'#24496e' } }, 'Nombre completo'),
        e('input', { value:name, onChange:ev=>setName(ev.target.value),
          className:'w-full px-3 py-2 border rounded-xl', style:{ borderColor:'#d7dbe0' }, placeholder:'Ej: Natalia Pérez' })
      ),
      e('div', null,
        e('label', { className:'block text-sm font-medium mb-1', style:{ color:'#24496e' } }, 'Artículo'),
        e('select', { value:article, onChange:ev=>setArticle(ev.target.value),
          className:'px-3 py-2 border rounded-xl', style:{ borderColor:'#d7dbe0' } },
          e('option', {value:'la'}, 'la'),
          e('option', {value:'el'}, 'el'),
          e('option', {value:'le'}, 'le')
        )
      ),
      e('div', null,
        e('button', { onClick:()=>{ onSave({ name:name.trim(), article }); onClose(); },
          className:'px-4 py-2 rounded-xl text-white font-semibold', style:{ background:'#6c467e' } }, 'Guardar')
      )
    )
  );
}

// App principal
function App() {
  const [state, setState] = useState(loadState());
  const courses = state.courses;
  const selectedCourseId = state.selectedCourseId;
  const selectedDate = state.selectedDate || todayStr();

  // Perfil del/la profe
  const [teacher, setTeacher] = useState(loadTeacher());
  const [teacherOpen, setTeacherOpen] = useState(false);

  // Modal de notas
  const [gradesOpen, setGradesOpen] = useState(false);
  const [gradesStudentId, setGradesStudentId] = useState(null);

  // Modal de inasistencias
  const [absencesOpen, setAbsencesOpen] = useState(false);
  const [absencesStudentId, setAbsencesStudentId] = useState(null);

  // Modales nuevos
  const [exportOpen, setExportOpen] = useState(false);
  const [newCourseOpen, setNewCourseOpen] = useState(false);

  useEffect(() => { saveState(state); }, [state]);

  // Primer inicio: pedir nombre
  useEffect(() => {
    if(!(teacher && teacher.name)){
      setTeacherOpen(true);
    }
  }, []);
  useEffect(() => { if(teacher) saveTeacher(teacher); }, [teacher]);

  // Exponer función para abrir Exportar/Importar desde el footer
  useEffect(() => {
    window.__openExport = () => setExportOpen(true);
    return () => { try { delete window.__openExport; } catch(_){} };
  }, []);

  const selectedCourse = selectedCourseId ? courses[selectedCourseId] : null;

  function setSelectedDate(dateStr){ setState(s => Object.assign({}, s, { selectedDate: dateStr || todayStr() })); }
  function selectCourse(id){ setState(s => Object.assign({}, s, { selectedCourseId:id })); }
  function createCourseFromModal(payload){
    const id = uid('curso');
    setState(s => {
      const next = Object.assign({}, s);
      next.selectedCourseId = id;
      next.courses = Object.assign({}, s.courses);
      next.courses[id] = { id, name:payload.name, days:payload.days||[], preceptor:payload.preceptor||{}, students:{} };
      return next;
    });
  }
  function createCourse(){ setNewCourseOpen(true); }
  function renameCourse(id, newName){
    setState(s=>{
      const next = Object.assign({}, s);
      next.courses = Object.assign({}, s.courses);
      const c = Object.assign({}, next.courses[id]); c.name = newName; next.courses[id] = c;
      return next;
    });
  }
  function deleteCourse(id){
    if (!confirm('¿Eliminar curso y toda su información?')) return;
    setState(s=>{
      const next = Object.assign({}, s);
      next.courses = Object.assign({}, s.courses);
      delete next.courses[id];
      if (s.selectedCourseId === id) next.selectedCourseId = null;
      return next;
    });
  }
  function addStudent(name, condition){
    if(!selectedCourseId) return;
    const id = uid('alumno');
    setState(s=>{
      const next = Object.assign({}, s);
      const course = Object.assign({}, next.courses[selectedCourseId]);
      const students = Object.assign({}, course.students);
      students[id] = { id, name, condition: (condition || 'cursa'), stats:{present:0, absent:0, later:0}, history:[], grades:[] };
      course.students = students;
      next.courses = Object.assign({}, next.courses);
      next.courses[selectedCourseId] = course;
      return next;
    });
  }
  function editStudent(id, payload){
    setState(s=>{
      const next = Object.assign({}, s);
      const course = Object.assign({}, next.courses[selectedCourseId]);
      const students = Object.assign({}, course.students);
      const st = Object.assign({}, students[id]);
      if (typeof payload === 'string') { st.name = payload; }
      else if (payload && typeof payload === 'object') {
        if (payload.name) st.name = payload.name;
        if (payload.condition) st.condition = payload.condition;
      }
      students[id] = st; course.students = students;
      next.courses = Object.assign({}, next.courses); next.courses[selectedCourseId] = course;
      return next;
    });
  }
  function deleteStudent(id){
    if(!confirm('¿Seguro que querés eliminar a este estudiante y toda su información?')) return;
    setState(s=>{
      const next = Object.assign({}, s);
      const course = Object.assign({}, next.courses[selectedCourseId]);
      const students = Object.assign({}, course.students);
      delete students[id]; course.students = students;
      next.courses = Object.assign({}, next.courses); next.courses[selectedCourseId] = course;
      return next;
    });
  }
  function markAttendance(studentId, action, dateStr){
    setState(s=>{
      const next = Object.assign({}, s);
      const course = Object.assign({}, next.courses[selectedCourseId]);
      const students = Object.assign({}, course.students);
      const st = Object.assign({}, students[studentId]);
      let stats = safeStats(st.stats); stats = { present:stats.present||0, absent:stats.absent||0, later:stats.later||0 };
      if (action==='present') stats.present += 1;
      if (action==='absent')  stats.absent  += 1;
      if (action==='later')   stats.later   += 1;
      const history = (st.history || []).slice();
      history.push({ id: uid('hist'), date: dateStr || todayStr(), status: action });
      st.stats = stats; st.history = history; students[studentId] = st; course.students = students;
      next.courses = Object.assign({}, next.courses); next.courses[selectedCourseId] = course;
      return next;
    });
  }
  function undoAttendance(studentId, action, dateStr){
    setState(s=>{
      const next = Object.assign({}, s);
      const course = Object.assign({}, next.courses[selectedCourseId]);
      const students = Object.assign({}, course.students);
      const st = Object.assign({}, students[studentId]);
      let stats = safeStats(st.stats); stats = { present:stats.present||0, absent:stats.absent||0, later:stats.later||0 };
      const hist = (st.history || []).slice();
      for (let i = hist.length - 1; i >= 0; i--) {
        const h = hist[i];
        if (h.status === action && (dateStr ? h.date === dateStr : true)) {
          hist.splice(i, 1);
          if (action==='present' && stats.present>0) stats.present -= 1;
          if (action==='absent'  && stats.absent>0)  stats.absent  -= 1;
          if (action==='later'   && stats.later>0)   stats.later   -= 1;
          break;
        }
      }
      st.stats = stats; st.history = hist; students[studentId] = st; course.students = students;
      next.courses = Object.assign({}, next.courses); next.courses[selectedCourseId] = course;
      return next;
    });
  }

  function openGrades(student){ setGradesStudentId(student.id); setGradesOpen(true); }
  function openAbsences(student){ setAbsencesStudentId(student.id); setAbsencesOpen(true); }

  function addGrade(studentId, grade){
    setState(s=>{
      const next = Object.assign({}, s);
      const course = Object.assign({}, next.courses[selectedCourseId]);
      const students = Object.assign({}, course.students);
      const st = Object.assign({}, students[studentId]);
      const grades = (st.grades || []).slice(); grades.push(grade);
      st.grades = grades; students[studentId] = st; course.students = students;
      next.courses = Object.assign({}, next.courses); next.courses[selectedCourseId] = course;
      return next;
    });
  }
  function editGrade(studentId, grade){
    setState(s=>{
      const next = Object.assign({}, s);
      const course = Object.assign({}, next.courses[selectedCourseId]);
      const students = Object.assign({}, course.students);
      const st = Object.assign({}, students[studentId]);
      const grades = (st.grades || []).slice();
      const idx = grades.findIndex(g => g.id === grade.id);
      if(idx !== -1) grades[idx] = grade;
      st.grades = grades; students[studentId] = st; course.students = students;
      next.courses = Object.assign({}, next.courses); next.courses[selectedCourseId] = course;
      return next;
    });
  }
  function deleteGrade(studentId, gradeId){
    setState(s=>{
      const next = Object.assign({}, s);
      const course = Object.assign({}, next.courses[selectedCourseId]);
      const students = Object.assign({}, course.students);
      const st = Object.assign({}, students[studentId]);
      const grades = (st.grades || []).filter(g => g.id !== gradeId);
      st.grades = grades; students[studentId] = st; course.students = students;
      next.courses = Object.assign({}, next.courses); next.courses[selectedCourseId] = course;
      return next;
    });
  }

  function applyAbsenceChange(studentId, histId, reason){
    setState(s=>{
      const next = Object.assign({}, s);
      const course = Object.assign({}, next.courses[selectedCourseId]);
      const students = Object.assign({}, course.students);
      const st = Object.assign({}, students[studentId]);
      const stats = safeStats(st.stats);
      const hist = (st.history || []).slice();
      const idx = hist.findIndex(h => h.id === histId);
      if (idx === -1) return s;

      const entry = Object.assign({}, hist[idx]);

      if (reason === 'erronea') {
        if (entry.status === 'absent' && stats.absent > 0) stats.absent -= 1;
        if (entry.status === 'tarde'  && stats.later  > 0) stats.later  -= 1;

        // Reetiquetar como presente y sumar 1 a presentes
        entry.status = 'present';
        delete entry.reason;
        stats.present = (stats.present || 0) + 1;
        hist[idx] = entry;
      } else if (reason === 'tarde') {
        // Contar 'tarde' también como presencia
        if (entry.status === 'absent') {
          if (stats.absent > 0) stats.absent -= 1;
        }
        // Sumar tardanza si aún no lo era
        if (entry.status !== 'tarde') {
          stats.later = (stats.later || 0) + 1;
        }
        // ✅ Siempre suma 1 a presentes (criterio pedido por Naty)
        stats.present = (stats.present || 0) + 1;

        entry.status = 'tarde';
        delete entry.reason;
        hist[idx] = entry;
      } else if (reason === 'justificada') {
        entry.status = 'absent';
        entry.reason = 'justificada';
        hist[idx] = entry;
      }

      st.history = hist;
      st.stats = { present: stats.present||0, absent: stats.absent||0, later: stats.later||0 };
      students[studentId] = st; course.students = students;
      next.courses = Object.assign({}, next.courses); next.courses[selectedCourseId] = course;
      return next;
    });
  }

  const studentsArr = useMemo(() => {
    if (!selectedCourse) return [];
    return Object.values(selectedCourse.students).sort((a,b)=>a.name.localeCompare(b.name));
  }, [selectedCourse]);

  const gradesStudent = selectedCourse && gradesStudentId ? selectedCourse.students[gradesStudentId] || null : null;
  const absencesStudent = selectedCourse && absencesStudentId ? selectedCourse.students[absencesStudentId] || null : null;

  function exportStateJSON(){
    try{
      const data = JSON.stringify(state, null, 2);
      const blob = new Blob([data], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'agenda_backup.json'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      alert('Exportación lista: se descargó agenda_backup.json');
    } catch(err){ alert('No se pudo exportar: ' + (err && err.message ? err.message : err)); }
  }
  function importStateFromText(text){
    try{
      const parsed = JSON.parse(text);
      const next = { courses: parsed && typeof parsed.courses==='object' ? parsed.courses : {}, selectedCourseId: parsed && parsed.selectedCourseId ? parsed.selectedCourseId : null, selectedDate: todayStr() };
      setState(next); alert('Importación exitosa.');
    } catch(err){ alert('Archivo inválido.'); }
  }
  function exportXLSX(){
    if (!selectedCourse) { alert('Primero seleccioná un curso.'); return; }
    const course = selectedCourse;
    const rowsHist = [['Estudiante','Fecha','Estado']];
    Object.values(course.students).forEach(st => { (st.history || []).forEach(h => rowsHist.push([st.name, h.date || '', h.status || ''])); });
    const rowsGrades = [['Estudiante','Fecha','Tipo','Nota']];
    Object.values(course.students).forEach(st => { (st.grades || []).forEach(g => rowsGrades.push([st.name, g.date || '', g.tipo || '', g.value])); });
    const rowsAvg = [['Estudiante','Promedio']];
    Object.values(course.students).forEach(st => rowsAvg.push([st.name, avg(st.grades||[])]));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowsHist), 'Historial');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowsGrades), 'Calificaciones');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rowsAvg), 'Promedios');
    XLSX.writeFile(wb, `asistencia_${(course.name||'curso').replace(/\s+/g,'_')}.xlsx`);
  }

  function notifyPreceptor(student, attendancePct, promedio){
    const course = selectedCourse;
    const phone = sanitizePhone(course?.preceptor?.phone || '');
    if(!phone){ alert('Este curso no tiene teléfono de preceptor configurado.'); return; }
    const url = `https://wa.me/${phone}?text=${buildRiskMessage(course, student, attendancePct, promedio.toFixed(2), teacher)}`;
    if(confirm(`Se abrirá WhatsApp para avisar al preceptor (${course.preceptor.name||''}). ¿Continuar?`)){
      window.open(url, '_blank', 'noopener');
    }
  }

  function saveTeacherProfile(t){
    setTeacher({ name: (t?.name || '').trim(), article: (t?.article || 'la') });
  }

  return e('div', null,
    e(Header, { selectedDate, onChangeDate:setSelectedDate }),
    e('main', { className:'max-w-5xl mx-auto' },
      Object.keys(courses).length === 0
        ? e(EmptyState, { onCreateCourse:createCourse })
        : e(CoursesBar, { courses, selectedCourseId, onSelect:selectCourse, onCreate:createCourse, onRename:renameCourse, onDelete:deleteCourse }),
      selectedCourse
        ? e('div', null,
            e(RollCallCard, { students:studentsArr, selectedDate, onMark:markAttendance, onUndo:undoAttendance }),
            e(StudentsTable, {
              course:selectedCourse,
              students:selectedCourse.students||{},
              onAdd:addStudent,
              onEdit:editStudent,
              onDelete:deleteStudent,
              onShowAbsences:(s)=>openAbsences(s),
              onOpenGrades:(s)=>openGrades(s),
              onNotifyPreceptor:(s, a, p)=>notifyPreceptor(s, a, p)
            })
          )
        : null
    ),
    e(ExportModal, {
      open:exportOpen,
      onClose:()=>setExportOpen(false),
      onExportJSON:exportStateJSON,
      onImportJSON:importStateFromText,
      onExportXLSX:exportXLSX
    }),
    e(NewCourseModal, {
      open:newCourseOpen,
      onClose:()=>setNewCourseOpen(false),
      onCreate:createCourseFromModal
    }),
    e(GradesModal, {
      open:gradesOpen,
      student:gradesStudent,
      onClose:()=>setGradesOpen(false),
      onAdd:(g)=>{ if(gradesStudent) addGrade(gradesStudent.id, g); },
      onEdit:(g)=>{ if(gradesStudent) editGrade(gradesStudent.id, g); },
      onDelete:(id)=>{ if(gradesStudent) deleteGrade(gradesStudent.id, id); }
    }),
    e(AbsencesModal, {
      open:absencesOpen,
      student:absencesStudent,
      onClose:()=>setAbsencesOpen(false),
      onApplyChange:(histId, reason)=>{
        if(absencesStudent){
          applyAbsenceChange(absencesStudent.id, histId, reason);
        }
      }
    }),
    e(TeacherProfileModal, {
      open: teacherOpen,
      onClose: ()=> setTeacherOpen(false),
      onSave: saveTeacherProfile,
      initial: teacher
    })
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(e(AppShell));
