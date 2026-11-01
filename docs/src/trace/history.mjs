const clone=value=>JSON.parse(JSON.stringify(value));
// Browser-session history only: never mix floors or source pages, never mutate snapshots.
export class TraceHistory {
 constructor(limit=40){this.limit=limit;this.stacks=new Map();}
 record(key,state){const stack=this.stacks.get(key)||[];stack.push(clone(state));if(stack.length>this.limit)stack.shift();this.stacks.set(key,stack);}
 take(key){const stack=this.stacks.get(key);return stack?.length?clone(stack.pop()):null;}
 clear(){this.stacks.clear();}
}
