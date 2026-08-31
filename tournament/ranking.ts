export interface Candidate {id:string;name:string;src:string;description:string;source:string;sha256?:string}
export type FeedbackOutcome = 'skip'|'like-both'|'hate-both';
export interface Comparison {id:string;left:string;right:string;outcome:'winner'|FeedbackOutcome;winner:string|null;loser:string|null;note:string;at:string;pass:number}
export interface Rating {elo:number;wins:number;losses:number;likes:number;hates:number;skips:number;score:number;assessed:boolean}
export interface Merge {a:string[];b:string[];sorted:string[]}
export interface Tournament {
  protocol:'this-or-that/tournament/v1';id:string;revision:number;title:string;mode:'human'|'rehearsal';createdAt:string;
  candidates:Candidate[];notes:Record<string,string>;ratings:Record<string,Rating>;comparisons:Comparison[];
  pass:number;stage:number;runs:string[][];nextRuns:string[][];merge:Merge|null;
  pair:{id:string;left:string;right:string}|null;order:string[];previousOrder:string[];winnerId:string|null;
  receipts:{id:string;digest:string}[];passSeeds:Record<string,string[]>;
}
export type Command = {type:'vote';pairId:string;winner:string;note?:string;notes?:Record<string,string>}|{type:'feedback';pairId:string;outcome:FeedbackOutcome;note?:string;notes?:Record<string,string>}|{type:'note';candidateId:string;text:string}|{type:'undo'}|{type:'refine'};

export function isFeedbackOutcome(value:unknown):value is FeedbackOutcome{return value==='skip'||value==='like-both'||value==='hate-both';}
function shuffled(ids:string[]):string[]{const copy=[...ids];for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j]!,copy[i]!];}return copy;}
function resetRatings(state:Tournament):void{
  state.ratings={};for(const c of state.candidates)state.ratings[c.id]={elo:1000,wins:0,losses:0,likes:0,hates:0,skips:0,score:1000,assessed:false};
}
function updateRating(rating:Rating):void{rating.score=rating.elo+16*(rating.likes-rating.hates);rating.assessed=rating.wins+rating.losses+rating.likes+rating.hates>0;}
function recordEvidence(state:Tournament,comparison:Comparison):void{
  if(comparison.outcome==='winner'){
    if(comparison.winner===null||comparison.loser===null)throw new Error('A winning comparison needs a winner and loser');
    const w=state.ratings[comparison.winner]!,l=state.ratings[comparison.loser]!;
    const gain=32*(1-1/(1+10**((l.elo-w.elo)/400)));w.elo+=gain;l.elo-=gain;w.wins++;l.losses++;updateRating(w);updateRating(l);
  }else{
    if(!isFeedbackOutcome(comparison.outcome))throw new Error('Invalid feedback outcome');
    const left=state.ratings[comparison.left]!,right=state.ratings[comparison.right]!;
    if(comparison.outcome==='skip'){left.skips++;right.skips++;}
    else if(comparison.outcome==='like-both'){left.likes++;right.likes++;}
    else{left.hates++;right.hates++;}
    updateRating(left);updateRating(right);
  }
}
function rankedCandidates(state:Tournament):Candidate[]{return [...state.candidates].sort((a,b)=>{const x=state.ratings[a.id]!,y=state.ratings[b.id]!;return Number(y.assessed)-Number(x.assessed)||y.score-x.score||a.id.localeCompare(b.id);});}
function updateResult(state:Tournament):void{
  state.winnerId=null;if(!state.order.length)return;
  const ranked=rankedCandidates(state);state.order=ranked.map(c=>c.id);
  const first=ranked[0],second=ranked[1];
  if(first&&state.ratings[first.id]!.assessed&&(!second||!state.ratings[second.id]!.assessed||state.ratings[first.id]!.score>state.ratings[second.id]!.score))state.winnerId=first.id;
}
export function normalizeTournament(state:Tournament):Tournament{
  resetRatings(state);
  for(const comparison of state.comparisons){
    if(comparison.outcome===undefined)comparison.outcome='winner';
    if(isFeedbackOutcome(comparison.outcome)){comparison.winner=null;comparison.loser=null;}
    recordEvidence(state,comparison);
  }
  updateResult(state);return state;
}
function prepare(state:Tournament):void{
  while(!state.pair&&!state.order.length){
    if(state.merge){
      const merge=state.merge;
      if(!merge.a.length||!merge.b.length){state.nextRuns.push([...merge.sorted,...merge.a,...merge.b]);state.merge=null;continue;}
      const a=merge.a[0]!,b=merge.b[0]!;
      state.pair={id:crypto.randomUUID(),left:state.comparisons.length%2?a:b,right:state.comparisons.length%2?b:a};return;
    }
    if(state.runs.length>=2){state.merge={a:state.runs.shift()!,b:state.runs.shift()!,sorted:[]};continue;}
    if(state.runs.length)state.nextRuns.push(state.runs.shift()!);
    if(state.nextRuns.length===1){state.order=state.nextRuns[0]!;state.nextRuns=[];return;}
    state.runs=state.nextRuns;state.nextRuns=[];state.stage++;
  }
}
export function createTournament(title:string,candidates:Candidate[],mode:'human'|'rehearsal',id=crypto.randomUUID()):Tournament{
  const state:Tournament={protocol:'this-or-that/tournament/v1',id,revision:0,title,mode,createdAt:new Date().toISOString(),candidates:structuredClone(candidates),notes:{},ratings:{},comparisons:[],pass:1,stage:1,runs:shuffled(candidates.map(c=>c.id)).map(id=>[id]),nextRuns:[],merge:null,pair:null,order:[],previousOrder:[],winnerId:null,receipts:[],passSeeds:{}};
  for(const c of candidates)state.notes[c.id]='';resetRatings(state);
  state.passSeeds['1']=state.runs.flat();
  prepare(state);updateResult(state);return state;
}
function text(value:unknown):string {if(typeof value!=='string'||value.length>20000)throw new Error('Notes must be text, at most 20,000 characters');return value;}
function applyComparison(state:Tournament,comparison:Comparison):void{
  const m=state.merge!;
  if(comparison.outcome==='winner'){
    if(m.a[0]===comparison.winner)m.sorted.push(m.a.shift()!);else if(m.b[0]===comparison.winner)m.sorted.push(m.b.shift()!);else throw new Error('Winner is not in the current merge');
  }else{
    if(!isFeedbackOutcome(comparison.outcome))throw new Error('Invalid feedback outcome');
    // Consume both heads as a scheduling batch, not a preference between them.
    m.sorted.push(m.a.shift()!,m.b.shift()!);
  }
  recordEvidence(state,comparison);state.comparisons.push(comparison);state.pair=null;prepare(state);
}
export function act(state:Tournament,command:Command,requestId:string):Tournament{
  const next=structuredClone(state);
  if(command.type==='note'){
    if(!(command.candidateId in next.notes))throw new Error('Unknown candidate');next.notes[command.candidateId]=text(command.text);
  }else if(command.type==='vote'||command.type==='feedback'){
    if(!next.pair||next.pair.id!==command.pairId)throw new Error('This matchup has changed; inspect the current pair');
    if(command.type==='vote'&&command.winner!==next.pair.left&&command.winner!==next.pair.right)throw new Error('Choose one of the current two candidates');
    if(command.type==='feedback'&&!isFeedbackOutcome(command.outcome))throw new Error('Invalid feedback outcome');
    if(command.notes)for(const [id,value] of Object.entries(command.notes)){if(!(id in next.notes))throw new Error('Unknown candidate note');next.notes[id]=text(value);}
    const winner=command.type==='vote'?command.winner:null;
    const comparison:Comparison={id:requestId,left:next.pair.left,right:next.pair.right,outcome:command.type==='vote'?'winner':command.outcome,winner,loser:winner===null?null:winner===next.pair.left?next.pair.right:next.pair.left,note:text(command.note??''),at:new Date().toISOString(),pass:next.pass};applyComparison(next,comparison);
  }else if(command.type==='refine'){
    if(!next.order.length)throw new Error('Finish this ranking pass first');next.previousOrder=next.order;next.order=[];next.winnerId=null;next.pass++;next.stage=1;next.runs=shuffled(next.candidates.map(c=>c.id)).map(id=>[id]);next.passSeeds[String(next.pass)]=next.runs.flat();next.nextRuns=[];next.merge=null;next.pair=null;prepare(next);
  }else if(command.type==='undo'){
    const last=next.comparisons.at(-1);if(!last||last.pass!==next.pass)throw new Error('No choice to undo in this pass');
    const seed=next.passSeeds[String(next.pass)]!;const earlier=next.comparisons.filter(v=>v.pass<next.pass);const current=next.comparisons.filter(v=>v.pass===next.pass).slice(0,-1);
    next.comparisons=[];resetRatings(next);
    for(const comparison of earlier){recordEvidence(next,comparison);next.comparisons.push(comparison);}
    next.runs=seed.map(id=>[id]);next.nextRuns=[];next.merge=null;next.pair=null;next.order=[];next.winnerId=null;next.stage=1;prepare(next);
    for(const comparison of current)applyComparison(next,comparison);
  }else throw new Error('Unknown action');
  updateResult(next);next.revision++;return next;
}
export function standings(state:Tournament){
  let rank=0,previousScore:number|undefined;
  return rankedCandidates(state).map((candidate,i)=>{
    const rating=state.ratings[candidate.id]!;
    if(rating.assessed&&rating.score!==previousScore)rank=i+1;
    previousScore=rating.score;
    return {rank:state.order.length&&rating.assessed?rank:null,candidate,...rating,note:state.notes[candidate.id],provisional:!state.order.length};
  });
}
