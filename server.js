const express = require('express');
const http = require('http');
const path = require('path');
const axios = require('axios');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'client', 'dist')));

const TILE_DISTRIBUTION = {A:[9,1],B:[2,3],C:[2,3],D:[4,2],E:[12,1],F:[2,4],G:[3,2],H:[2,4],I:[9,1],J:[1,8],K:[1,5],L:[4,1],M:[2,3],N:[6,1],O:[8,1],P:[2,3],Q:[1,10],R:[6,1],S:[4,1],T:[6,1],U:[4,1],V:[2,4],W:[2,4],X:[1,8],Y:[2,4],Z:[1,10]};
function createTileBag(){ const bag = []; Object.entries(TILE_DISTRIBUTION).forEach(([ltr,[count]])=>{ for(let i=0;i<count;i++) bag.push(ltr); }); for(let i=bag.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [bag[i],bag[j]]=[bag[j],bag[i]]; } return bag; }
function drawTiles(bag,n){ const out=[]; for(let i=0;i<n && bag.length;i++) out.push(bag.pop()); return out; }
function letterValue(ch){ return TILE_DISTRIBUTION[ch]?.[1]||1; }

const BONUS = {};
const tripleWord = [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]];
const doubleWord = [[1,1],[2,2],[3,3],[4,4],[13,13],[12,12],[11,11],[10,10],[1,13],[2,12],[3,11],[4,10],[13,1],[12,2],[11,3],[10,4]];
const tripleLetter = [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]];
const doubleLetter = [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],[7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],[14,3],[14,11]];
tripleWord.forEach(([r,c])=> BONUS[`${r},${c}`]='TW');
doubleWord.forEach(([r,c])=> BONUS[`${r},${c}`]='DW');
tripleLetter.forEach(([r,c])=> BONUS[`${r},${c}`]='TL');
doubleLetter.forEach(([r,c])=> BONUS[`${r},${c}`]='DL');
BONUS['7,7'] = 'DW';

const games = {};
function newGame(id){
  return { id, board: Array.from({length:15},()=>Array(15).fill(null)), bonusesUsed:{}, players:[], bag:createTileBag(), turnIndex:0, active:false, history:[] };
}
function sanitize(g){ return { id:g.id, board:g.board, players:g.players.map(p=>({id:p.id,name:p.name,team:p.team,score:p.score,rackCount:p.rack.length})), fullPlayers:g.players.map(p=>({id:p.id,name:p.name,team:p.team,score:p.score,rack:p.rack})), turnIndex:g.turnIndex, bagCount:g.bag.length, history:g.history }; }

async function isValidWord(word){
  if(!word) return false;
  try{ const res = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`); return res.status===200; }catch(e){ return false; }
}

function getWordsFromBoard(board, placements){
  const words = new Set();
  placements.forEach(pl=>{
    const x=pl.x,y=pl.y;
    let sx=x; while(sx>0 && board[y][sx-1]) sx--;
    let ex=x; while(ex<14 && board[y][ex+1]) ex++;
    if(ex-sx>=0){ let w=''; for(let cx=sx;cx<=ex;cx++) w += board[y][cx]||'-'; if(!w.includes('-')) words.add(w); }
    let sy=y; while(sy>0 && board[sy-1][x]) sy--;
    let ey=y; while(ey<14 && board[ey+1][x]) ey++;
    if(ey-sy>=0){ let w=''; for(let cy=sy;cy<=ey;cy++) w += board[cy][x]||'-'; if(!w.includes('-')) words.add(w); }
  });
  return Array.from(words);
}

function calculateScoreForPlacement(g, placements){
  const boardCopy = g.board.map(r=>r.slice());
  placements.forEach(p=> boardCopy[p.y][p.x] = p.letter.toUpperCase());
  const words = getWordsFromBoard(boardCopy, placements);
  if(words.length===0) return {valid:false, reason:'no_word'};
  // compute score
  let total = 0;
  const newPos = {}; placements.forEach(p=> newPos[`${p.y},${p.x}`]=p.letter.toUpperCase());
  for(const w of words){
    // find where word occurs on boardCopy - brute force
    let matched=false;
    for(let y=0;y<15 && !matched;y++){
      for(let sx=0;sx<15 && !matched;sx++){
        let built=''; let ex=sx;
        while(ex<15 && (boardCopy[y][ex])){ built += boardCopy[y][ex]; ex++; if(built.length===w.length && built===w){ // compute score
            let wordScore=0; let wordMul=1;
            for(let cx=sx; cx<ex; cx++){
              const ch = boardCopy[y][cx];
              let lv = TILE_DISTRIBUTION[ch][1];
              if(newPos.hasOwnProperty(`${y},${cx}`)){
                const b = BONUS[`${y},${cx}`];
                if(b==='DL') lv *=2;
                if(b==='TL') lv *=3;
                if(b==='DW') wordMul *=2;
                if(b==='TW') wordMul *=3;
              }
              wordScore += lv;
            }
            total += wordScore * wordMul;
            matched=true;
        } }
      }
    }
    if(!matched){ // vertical
      for(let x=0;x<15 && !matched;x++){
        for(let sy=0; sy<15 && !matched; sy++){
          let built=''; let ey=sy;
          while(ey<15 && (boardCopy[ey][x])){ built += boardCopy[ey][x]; ey++; if(built.length===w.length && built===w){
              let wordScore=0; let wordMul=1;
              for(let cy=sy; cy<ey; cy++){
                const ch = boardCopy[cy][x];
                let lv = TILE_DISTRIBUTION[ch][1];
                if(newPos.hasOwnProperty(`${cy},${x}`)){
                  const b = BONUS[`${cy},${x}`];
                  if(b==='DL') lv *=2;
                  if(b==='TL') lv *=3;
                  if(b==='DW') wordMul *=2;
                  if(b==='TW') wordMul *=3;
                }
                wordScore += lv;
              }
              total += wordScore * wordMul;
              matched=true;
          } }
        }
      }
    }
  }
  return {valid:true, words, score: total};
}

io.on('connection', socket=>{
  socket.on('createRoom', ({roomId})=>{
    const id = roomId || `room-${Math.random().toString(36).slice(2,8)}`;
    if(!games[id]) games[id]=newGame(id);
    socket.join(id); socket.data.roomId = id; io.in(id).emit('gameState', sanitize(games[id]));
  });

  socket.on('joinRoom', ({roomId,name,team})=>{
    if(!roomId) return socket.emit('actionError','no_room');
    if(!games[roomId]) games[roomId]=newGame(roomId);
    const g = games[roomId];
    socket.join(roomId);
    socket.data.roomId = roomId; socket.data.name = name; socket.data.team = team;
    if(!g.players.find(p=>p.id===socket.id)){
      const player = { id: socket.id, name: name||`Player-${g.players.length+1}`, team: team||'arabica', rack: drawTiles(g.bag,7), score:0 };
      g.players.push(player);
    }
    io.in(roomId).emit('gameState', sanitize(g));
  });

  socket.on('startGame', ({roomId})=>{
    if(!roomId) return; if(!games[roomId]) games[roomId]=newGame(roomId);
    const g = games[roomId]; g.active = true; g.turnIndex = 0; io.in(roomId).emit('gameState', sanitize(g));
  });

  socket.on('placeTiles', async ({roomId, placements})=>{
    const g = games[roomId]; if(!g) return socket.emit('actionError','no_game');
    const player = g.players.find(p=>p.id===socket.id); if(!player) return socket.emit('actionError','not_player');
    if(g.players[g.turnIndex]?.id !== socket.id) return socket.emit('actionError','not_your_turn');
    const rackCopy = player.rack.slice();
    for(const pl of placements){ const up = pl.letter.toUpperCase(); if(!rackCopy.includes(up)) return socket.emit('actionError','tile_not_in_rack'); else { const idx = rackCopy.indexOf(up); rackCopy.splice(idx,1); } }
    for(const pl of placements){ if(pl.x<0||pl.x>14||pl.y<0||pl.y>14) return socket.emit('actionError','out_of_bounds'); if(g.board[pl.y][pl.x]) return socket.emit('actionError','cell_not_empty'); }
    placements.forEach(p=> g.board[p.y][p.x] = p.letter.toUpperCase());
    const check = calculateScoreForPlacement(g, placements);
    if(!check.valid){ placements.forEach(p=> { if(p.y>=0&&p.y<15&&p.x>=0&&p.x<15) g.board[p.y][p.x]=null; }); return socket.emit('actionError', check.reason || 'invalid'); }
    for(const w of check.words){
      const ok = await isValidWord(w);
      if(!ok){ placements.forEach(p=> { if(p.y>=0&&p.y<15&&p.x>=0&&p.x<15) g.board[p.y][p.x]=null; }); return socket.emit('actionError','invalid_word:'+w); }
    }
    player.score += check.score;
    for(const pl of placements){ const idx = player.rack.indexOf(pl.letter.toUpperCase()); if(idx!==-1) player.rack.splice(idx,1); }
    player.rack.push(...drawTiles(g.bag, 7-player.rack.length));
    g.history.push({type:'place', by:player.id, placements, words:check.words, gained:check.score});
    placements.forEach(p=> { g.bonusesUsed[`${p.y},${p.x}`] = true; });
    g.turnIndex = (g.turnIndex + 1) % Math.max(1, g.players.length);
    io.in(roomId).emit('gameState', sanitize(g));
  });

  socket.on('passTurn', ({roomId})=>{ const g = games[roomId]; if(!g) return; const idx = g.players.findIndex(p=>p.id===socket.id); if(idx===-1) return; g.history.push({type:'pass', by:socket.id}); g.turnIndex=(g.turnIndex+1)%Math.max(1,g.players.length); io.in(roomId).emit('gameState', sanitize(g)); });

  socket.on('swapTiles', ({roomId,tiles})=>{ const g = games[roomId]; if(!g) return; const player = g.players.find(p=>p.id===socket.id); if(!player) return; if(g.bag.length < tiles.length) return socket.emit('actionError','not_enough_tiles'); for(const t of tiles){ const idx = player.rack.indexOf(t); if(idx===-1) return socket.emit('actionError','tile_not_in_rack'); player.rack.splice(idx,1); g.bag.push(t); } for(let i=g.bag.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [g.bag[i],g.bag[j]]=[g.bag[j],g.bag[i]]; } player.rack.push(...drawTiles(g.bag,7-player.rack.length)); g.history.push({type:'swap', by:player.id, tiles}); g.turnIndex=(g.turnIndex+1)%Math.max(1,g.players.length); io.in(roomId).emit('gameState', sanitize(g)); });

  socket.on('chat', ({roomId,text})=>{ io.in(roomId).emit('chat',{name:socket.data.name||'Anon',text,ts:Date.now()}); });

  socket.on('disconnect', ()=>{ const roomId = socket.data.roomId; if(!roomId) return; const g = games[roomId]; if(!g) return; const idx = g.players.findIndex(p=>p.id===socket.id); if(idx!==-1){ g.players.splice(idx,1); io.in(roomId).emit('gameState', sanitize(g)); } });
});

app.get('/api/ping',(req,res)=> res.json({ok:true}));
app.get('*',(req,res)=>{ res.sendFile(path.join(__dirname,'client','dist','index.html')); });
server.listen(PORT, ()=> console.log('Server listening on', PORT));
