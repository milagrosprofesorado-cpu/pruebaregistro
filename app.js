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

// ====== Auth helpers ======
const SESSION_KEY = 'session_user_v1';

function parseCSV(text){
  // Simple CSV parser (no quotes, assuming simple CSV like your sheet)
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if(lines.length <= 1) return [];
  const header = lines[0].split(',').map(h=>h.trim().toLowerCase());
  const mapping = { usuario:-1, contrasena:-1, correo:-1 };
  header.forEach((h,i)=>{
    if(h.includes('usuario')||h.includes('user')||h.includes('nombre')) mapping.usuario = i;
    if(h.includes('pass')||h.includes('contras')||h.includes('contrasena')||h.includes('clave')) mapping.contrasena = i;
    if(h.includes('mail')||h.includes('correo')||h.includes('email')) mapping.correo = i;
  });
  const items = [];
  for(let i=1;i<lines.length;i++){
    const cols = lines[i].split(',').map(c => c.trim());
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

 /* ------------------ INICIO: Firebase Auth helpers + migración CSV ------------------ */
 // Si tu index.html ya carga Firebase SDK, estas funciones funcionarán.
 // Comprueba que `firebase` esté disponible; si no, la app seguirá usando el CSV.
 function firebaseRegister(email, password, displayName) {
   if(!window.firebase || !firebase.auth) return Promise.reject(new Error('Firebase no está inicializado'));
   return firebase.auth().createUserWithEmailAndPassword(email, password)
     .then(cred => {
       const user = cred.user;
       if (displayName && user.updateProfile) {
         return user.updateProfile({ displayName }).then(()=> user);
       }
       return user;
     })
     .then(user => {
       try {
         const db = firebase.firestore();
         return db.collection('users').doc(user.uid).set({
           uid: user.uid,
           email: user.email,
           displayName: user.displayName || '',
           createdAt: new Date().toISOString()
         }, { merge: true }).then(()=> user);
       } catch(e) {
         return user;
       }
     });
 }

 function firebaseLogin(email, password) {
   if(!window.firebase || !firebase.auth) return Promise.reject(new Error('Firebase no está inicializado'));
   return firebase.auth().signInWithEmailAndPassword(email, password)
     .then(cred => cred.user);
 }

 function firebaseLogout() {
   if(!window.firebase || !firebase.auth) return Promise.resolve();
   return firebase.auth().signOut();
 }

 // sincronizar estado de Firebase con session local
 if(window.firebase && firebase.auth){
   firebase.auth().onAuthStateChanged(user => {
     if (user) {
       const sess = { uid: user.uid, usuario: user.email, displayName: user.displayName || '' };
       try { saveSession(sess); } catch(e){}
       try { if (window.__onFirebaseLogin) window.__onFirebaseLogin(user); } catch(_) {}
     } else {
       try { clearSession(); } catch(e){}
       try { if (window.__onFirebaseLogout) window.__onFirebaseLogout(); } catch(_) {}
     }
   });
 }

 // --- Migración "al primer login" desde CSV
 async function tryMigrateFromCSVIfNeeded(emailOrUsername, password) {
   if(typeof fetchUsers !== 'function') return null;
   try {
     const users = await fetchUsers();
     const found = users.find(u => {
       const e = (u.correo || u.email || '').toString().toLowerCase();
       const n = (u.usuario || u.user || u.name || '').toString().toLowerCase();
       return (e && e === (emailOrUsername||'').toLowerCase()) || (n && n === (emailOrUsername||'').toLowerCase());
     });
     if(!found) return null;
     const csvPassword = (found.contrasena || found.password || '').toString();
     if(!csvPassword) return null;
     if(String(csvPassword) !== String(password)) return null;
     let email = found.correo || found.email;
     if(!email) email = (found.usuario || found.user || 'usuario') + '@migrado.local';
     const newUser = await firebaseRegister(email, password, found.usuario || found.name || '');
     return newUser;
   } catch(e){
     console.error('Error migrando desde CSV:', e);
     return null;
   }
 }

 async function loginWithFirebaseOrCsv(emailOrUsername, password) {
   // intenta Firebase; si falla por user-not-found, intenta migrar desde CSV y reintentar
   if(window.firebase && firebase.auth){
     try {
       return await firebaseLogin(emailOrUsername, password);
     } catch(e){
       const code = e && e.code ? e.code : '';
       if(code === 'auth/user-not-found' || code === 'auth/invalid-email' || code === 'auth/wrong-password' || code === 'auth/invalid-email'){
         // intentar migración
         try {
           const migrated = await tryMigrateFromCSVIfNeeded(emailOrUsername, password);
           if(migrated){
             const email = migrated.email || (emailOrUsername + '@migrado.local');
             return await firebaseLogin(email, password);
           }
         } catch(err){
           // fallthrough
         }
       }
       throw e;
     }
   } else {
     // Si no hay Firebase, fallará y que la app use el CSV clásico (fetchUsers).
     throw new Error('Firebase no disponible');
   }
 }

 async function handleLogout(){
   try { await firebaseLogout(); } catch(e){ console.warn('Logout firebase:', e); }
   try { clearSession(); } catch(e){}
 }
 /* ------------------ FIN: Firebase Auth helpers + migración CSV ------------------ */

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
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(ev){
    ev && ev.preventDefault();
    setError(''); setLoading(true);
    try {
      if(mode === 'login'){
        // intentar login con Firebase; si no está Firebase, se intentará con CSV aquí abajo
        try {
          const user = await loginWithFirebaseOrCsv(usuario, password);
          saveSession({ usuario: user.email || usuario, uid: user.uid, displayName: user.displayName || '' });
          onLogin && onLogin();
        } catch(e){
          // si firebase no está, o si el mensaje indica Firebase no disponible, intentamos CSV local
          if(String(e.message||'').toLowerCase().includes('firebase') || String(e.code||'') === 'auth/user-not-found') {
            // intentar con CSV (si existe)
            try {
              const users = await fetchUsers();
              const found = users.find(u => (u.usuario||'').toLowerCase() === (usuario||'').toLowerCase() || (u.correo||'').toLowerCase() === (usuario||'').toLowerCase());
              if(!found){ setError('Usuario no encontrado.'); return; }
              if(String(found.contrasena||'') !== String(password||'')){ setError('Contraseña incorrecta.'); return; }
              saveSession({ usuario: found.usuario, correo: found.correo || '' });
              onLogin && onLogin();
            } catch(csvErr){
              setError(e && e.message ? e.message : String(e));
            }
          } else {
            setError(e && e.message ? e.message : String(e));
          }
        }
      } else {
        // registro: crear en Firebase si está disponible, si no, mostrar error
        if(!displayName){ setError('Ingresá tu nombre completo.'); setLoading(false); return; }
        if(window.firebase && firebase.auth){
          try {
            const user = await firebaseRegister(usuario, password, displayName);
            saveSession({ usuario: user.email || usuario, uid: user.uid, displayName: user.displayName || '' });
            onLogin && onLogin();
          } catch(regErr){
            setError(regErr && regErr.message ? regErr.message : String(regErr));
          }
        } else {
          setError('Registro no disponible: Firebase no inicializado.');
        }
      }
    } catch(err){
      setError(err && err.message ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function forgotPassword(){
    const api = (window.PASSWORD_API_URL || '').trim();
    if(api){
      // si hay un API propio, mantener el comportamiento antiguo
      const usuarioLocal = usuario;
      if(!usuarioLocal){ alert('Ingresá tu usuario o correo primero'); return; }
      fetch(api, {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ action:'recover', usuario: usuarioLocal })
      }).then(async r => { try{ const j = await r.json(); alert(j && j.message ? j.message : 'Pedido enviado. Si es correcto, recibirás instrucciones.'); } catch(_) { alert('Pedido enviado.'); }})
      .catch(()=> alert('No se pudo contactar al servidor.'));
      return;
    }
    // Si Firebase está disponible, usar su sistema de reset
    if(window.firebase && firebase.auth){
      const email = prompt('Ingresá tu correo para recibir un link de recuperación:') || '';
      if(!email) return;
      firebase.auth().sendPasswordResetEmail(email)
        .then(()=> alert('Se envió un mail con instrucciones.'))
        .catch(e=> alert('Error: ' + (e.message||e)));
    } else {
      AdminMailLink('Recuperar contraseña', `Usuario: ${usuario}\n\nSolicito recuperar la contraseña.`);
    }
  }

  return e('div', { className:'min-h-dvh flex items-center justify-center p-6' },
    e('div', { className:'w-full max-w-sm bg-white rounded-3xl border shadow p-6', style:{ borderColor:'#d7dbe0' } },
      e('div', { className:'text-center mb-4' },
        e('div', { className:'text-2xl font-bold', style:{ color:'#24496e' } }, mode === 'login' ? 'Ingresá' : 'Registrate'),
        e('div', { className:'text-sm text-slate-600' }, 'Tomador de lista')
      ),
      e('form', { onSubmit:submit, className:'space-y-3' },
        mode === 'register' ? e('div', null,
          e('label', { className:'block text-sm mb-1', style:{color:'#24496e'} }, 'Nombre completo'),
          e('input', { value:displayName, onChange:e=>setDisplayName(e.target.value), className:'w-full px-3 py-2 border rounded-xl', style:{borderColor:'#d7dbe0'} })
        ) : null,
        e('div', null,
          e('label', { className:'block text-sm mb-1', style:{color:'#24496e'} }, 'Usuario o correo'),
          e('input', { value:usuario, onChange:e=>setUsuario(e.target.value), className:'w-full px-3 py-2 border rounded-xl', style:{borderColor:'#d7dbe0'}, autoFocus:true })
        ),
        e('div', null,
          e('label', { className:'block text-sm mb-1', style:{color:'#24496e'} }, 'Contraseña'),
          e('input', { type:'password', value:password, onChange:e=>setPassword(e.target.value), className:'w-full px-3 py-2 border rounded-xl', style:{borderColor:'#d7dbe0'} })
        ),
        error ? e('div', { className:'text-sm text-red-700 bg-red-50 rounded px-2 py-1' }, error) : null,
        e('button', { type:'submit', disabled:loading, className:'w-full px-4 py-2 rounded-2xl text-white font-semibold', style:{ background:'#6c467e', opacity: loading? .7:1 } }, loading ? (mode==='login' ? 'Ingresando...' : 'Registrando...') : (mode==='login' ? 'Ingresar' : 'Crear cuenta')),
        e('div', { className:'flex items-center justify-between text-sm pt-1' },
          e('button', { type:'button', onClick:forgotPassword, className:'underline', style:{color:'#24496e'} }, 'Olvidé mi contraseña'),
          e('button', { type:'button', onClick:()=>setMode(mode==='login' ? 'register' : 'login'), className:'underline', style:{color:'#24496e'} }, mode==='login' ? 'Crear cuenta' : 'Volver a ingresar')
        )
      )
    )
  );
}
