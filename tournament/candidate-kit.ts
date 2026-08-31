import { OWNERS, TICKETS, S0, cloneQueues, ticketById } from '../shared/fixture';
import { moveQueues } from '../shared/reducer';
import type { OwnerId, TicketId, Queues } from '../shared/contract';
export { OWNERS, TICKETS };

export function createDemo(onChange: () => void) {
  let queues=cloneQueues(S0), revision=0;
  const history: Queues[]=[];
  const changed=()=>{revision++;onChange();};
  const demo={
    owners:OWNERS,tickets:TICKETS,
    get queues(){return cloneQueues(queues);},
    get revision(){return revision;},
    ownerOf(id:TicketId):OwnerId {const owner=OWNERS.find(o=>queues[o.id].includes(id));if(!owner)throw new Error('Unknown ticket');return owner.id;},
    list(owner:OwnerId){return queues[owner].map(ticketById);},
    points(owner:OwnerId){return queues[owner].reduce((n,id)=>n+ticketById(id).points,0);},
    move(id:TicketId,owner:OwnerId,before:TicketId|null=null){
      const next=moveQueues(queues,{type:'pane.move',paneId:'A',expectedPaneRevision:revision,ticketId:id,fromOwnerId:demo.ownerOf(id),toOwnerId:owner,beforeTicketId:before});
      history.push(cloneQueues(queues));queues=next;changed();
    },
    shift(id:TicketId,delta:number){const owner=demo.ownerOf(id), list=queues[owner],from=list.indexOf(id),to=Math.max(0,Math.min(list.length-1,from+delta));if(to===from)return;const remaining=list.filter(t=>t!==id);demo.move(id,owner,remaining[to]??null);},
    reset(){history.push(cloneQueues(queues));queues=cloneQueues(S0);changed();},
    undo(){const prior=history.pop();if(prior){queues=prior;changed();}},
    inspect(){return {protocol:'this-or-that/candidate/v1',revision,queues:cloneQueues(queues),tickets:TICKETS,owners:OWNERS,actions:['move','shift','reset','undo'],scope:'Scratch interaction; not preference evidence'};},
  };
  Object.assign(window,{demo});
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==parent||event.data?.protocol!=='this-or-that/candidate/v1')return;
    const {requestId,operation,expectedRevision,ticketId,ownerId,beforeTicketId}=event.data;
    try{
      if(operation!=='inspect'&&expectedRevision!==revision)throw new Error('Stale candidate revision');
      if(operation==='move')demo.move(ticketId,ownerId,beforeTicketId??null);
      else if(operation==='reset')demo.reset();else if(operation==='undo')demo.undo();else if(operation!=='inspect')throw new Error('Unknown operation');
      parent.postMessage({protocol:'this-or-that/candidate/v1',requestId,ok:true,state:demo.inspect()},location.origin);
    }catch(error){parent.postMessage({protocol:'this-or-that/candidate/v1',requestId,ok:false,error:String(error)},location.origin);}
  });
  return demo;
}

document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&parent!==window)parent.postMessage({type:'tot:exit-interaction'},location.origin);
});
