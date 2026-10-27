import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,onAuthStateChanged,signOut} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {initializeFirestore,doc,getDoc,setDoc,collection,getDocs,query,orderBy,limit,runTransaction} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import {createWorkoutStore} from './workout-store.mjs?v=1.0.0';

const app=initializeApp({apiKey:'AIzaSyBzBe9pAttnbDgTlNThWZzNqtAAKxX7Ksw',authDomain:'jk-invest.firebaseapp.com',projectId:'jk-invest',storageBucket:'jk-invest.firebasestorage.app',messagingSenderId:'1024066323251',appId:'1:1024066323251:web:23d557527866205f01f446'});
const force=/iPhone|iPad|iPod|NAVER|KAKAOTALK|Instagram|FBAN|FBAV|; wv\)/i.test(navigator.userAgent||'')||(/Macintosh/i.test(navigator.userAgent||'')&&(navigator.maxTouchPoints||0)>1);
const auth=getAuth(app),db=initializeFirestore(app,force?{experimentalForceLongPolling:true}:{experimentalAutoDetectLongPolling:true});
const mine=uid=>{if(auth.currentUser?.uid!==uid)throw Object.assign(new Error('로그인 계정이 바뀌었습니다.'),{code:'stale_account'});};
const stateRef=uid=>doc(db,'users',uid,'workout','state');
const storage=createWorkoutStore({
  async readState(uid){mine(uid);const snap=await getDoc(stateRef(uid));mine(uid);return snap.exists()?snap.data():{schemaVersion:1,revision:0};},
  async readHistory(uid){mine(uid);const snap=await getDocs(query(collection(db,'users',uid,'workoutSessions'),orderBy('completedAt','desc'),limit(100)));mine(uid);return snap.docs.map(d=>({...d.data(),id:d.id}));},
  async writeState(uid,patch,expectedRevision){mine(uid);return runTransaction(db,async tx=>{mine(uid);const ref=stateRef(uid),snap=await tx.get(ref);mine(uid);const previous=snap.exists()?snap.data():{},revision=Number(previous.revision)||0;if(revision!==expectedRevision)throw Object.assign(new Error('다른 화면에서 설정을 변경했습니다.'),{code:'conflict'});const saved={...previous,...patch,schemaVersion:1,revision:revision+1,updatedAt:Date.now()};tx.set(ref,saved);return saved;});},
  async writeHistory(uid,record){mine(uid);const ref=doc(db,'users',uid,'workoutSessions',record.id);await runTransaction(db,async tx=>{mine(uid);const previous=await tx.get(ref);mine(uid);if(!previous.exists())tx.set(ref,{...record,schemaVersion:1});});},
  notify(detail){window.JKWorkoutContext=detail;window.dispatchEvent(new CustomEvent('jk-workout-data',{detail}));}
});
window.JKWorkoutStorage=storage;
JKAccess.guard({auth,db,doc,getDoc,setDoc,onAuthStateChanged,signInWithPopup,GoogleAuthProvider,signOut},{onUser(user){storage.close(user?.uid||null);},onOk(user){storage.open(user.uid).catch(()=>{});}});
