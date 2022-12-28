import { useState } from "react";
import PriorityQueue from "./PriorityQueue";
import ReactDataGrid from "@inovua/reactdatagrid-community";
import "@inovua/reactdatagrid-community/index.css";
import "@inovua/reactdatagrid-community/theme/default-dark.css";

const instructionQueueR = [];
const FPRR = [];
const storeBufferR = [];
const loadBufferR = [];
const addRSR = [];
const mulRSR = [];
let max;

const run = () => {
  const addLatency = 2;
  const subLatency = 2;
  const mulLatency = 10;
  const divLatency = 40;
  const loadLatency = 2;
  const storeLatency = 2;
  const addRSize = 3;
  const mulRSize = 2;
  const storeBufferSize = 3;
  const loadBufferSize = 3;
  const memorySize = 1024;

  const s =
    "L.D F6,33\nL.D F2,44\nMUL.D F0,F2,F4\nSUB.D F8,F6,F2\nDIV.D F10,F0,F6\nADD.D F6,F8,F2";

  const instructionQueue = s.split("\n").map((i) => {
    let s = i.trim().split(" ");
    let op = s[0];
    let reg = s[1].split(",").map((s) => {
      return s.trim();
    });

    if (op === "L.D" || op === "S.D" || op === "LW" || op === "SW") {
      return {
        op: op,
        R1: reg[0],
        address: reg[1],
        issue: null,
        executionComplete: { i: null, j: null },
        writeResults: null,
      };
    }
    return {
      op: op,
      destination: reg[0],
      source1: reg[1],
      source2: reg[2],
      issue: null,
      executionComplete: { i: null, j: null },
      writeResults: null,
    };
  });

  const storeBuffer = new Array(storeBufferSize).fill(0);
  const loadBuffer = new Array(loadBufferSize).fill(0);
  const addRS = new Array(addRSize).fill(0);
  const mulRS = new Array(mulRSize).fill(0);
  const GPR = new Array(32).fill({ qi: 0, val: 0 });
  const FPR = new Array(32).fill({ qi: 0, val: 0 });
  FPR[1] = { qi: 0, val: 1 };
  FPR[2] = { qi: 0, val: 2 };
  FPR[4] = { qi: 0, val: 3 };
  FPR[6] = { qi: 0, val: 4 };
  FPR[8] = { qi: 0, val: 5 };
  FPR[9] = { qi: 0, val: 6 };
  const memory = new Array(memorySize).fill(0);
  memory[33] = 5;
  memory[44] = 4;
  var waitingsToWrite = new PriorityQueue();
  let pc = 0;
  let clk = 1;
  let finisedItems = 0;
  let isIssued = false;
  let noOfWaiting = new Map();
  function RSentry(op, vj, vk, qj, qk, latency, instQueueIdx) {
    return {
      op: op,
      vj: vj,
      vk: vk,
      qj: qj,
      qk: qk,
      latency: latency,
      status: "ready",
      instQueueIdx: instQueueIdx,
    };
  }

  function loadEntry(address, latency, instQueueIdx) {
    return {
      address: address,
      latency: latency,
      status: "ready",
      instQueueIdx: instQueueIdx,
    };
  }

  function storeEntry(v, q, address, latency, instQueueIdx) {
    return {
      v: v,
      q: q,
      address: address,
      latency: latency,
      status: "ready",
      instQueueIdx: instQueueIdx,
    };
  }

  function registerEntry(qi, val) {
    return {
      qi: qi,
      val: val,
    };
  }

  function isEmpty(array) {
    for (let i = 0; i < array.length; i++) {
      if (array[i] === 0) return i;
    }

    return -1;
  }

  function checkRF(array, index) {
    if (array[index].qi === 0) return { flag: true, val: array[index].val };
    else {
      return { flag: false, qi: array[index].qi };
    }
  }
  function checkStoreClash(address) {
    for (let i = 0; i < storeBuffer.length; i++) {
      if (storeBuffer[i] !== 0 && storeBuffer[i].address === address) {
        return true;
      }
    }
    return false;
  }
  function checkLoadClash(address) {
    for (let i = 0; i < loadBuffer.length; i++) {
      if (loadBuffer[i] !== 0 && loadBuffer[i].address === address) {
        return true;
      }
    }
    return false;
  }
  function issue(index) {
    let inst = instructionQueue[index];
    let pos;
    let key;

    switch (inst.op) {
      case "ADD.D":
      case "SUB.D":
        pos = isEmpty(addRS);
        if (pos === -1) {
          return;
        }
        inst.issue = clk;
        let first = checkRF(FPR, inst.source1.slice(1));
        let sec = checkRF(FPR, inst.source2.slice(1));
        isIssued = true;
        let latency = inst.op === "ADD.D" ? addLatency : subLatency;
        addRS[pos] = RSentry(
          inst.op,
          first.flag ? first.val : null,
          sec.flag ? sec.val : null,
          !first.flag ? first.qi : null,
          !sec.flag ? sec.qi : null,
          latency,
          index
        );
        FPR[parseInt(inst.destination.slice(1))] = {
          qi: "A" + (pos + 1),
          val: FPR[parseInt(inst.destination.slice(1))].val,
        };
        if (!first.flag) {
          key = first.qi;
          noOfWaiting.set(
            key,
            noOfWaiting.has(key) ? noOfWaiting.get(key) + 1 : 1
          );
        }
        if (!sec.flag) {
          key = sec.qi;
          noOfWaiting.set(
            key,
            noOfWaiting.has(key) ? noOfWaiting.get(key) + 1 : 1
          );
        }

        break;
      case "MUL.D":
      case "DIV.D":
        pos = isEmpty(mulRS);
        if (pos === -1) {
          return;
        }
        inst.issue = clk;
        isIssued = true;
        let first1 = checkRF(FPR, inst.source1.slice(1));
        let sec1 = checkRF(FPR, inst.source2.slice(1));
        let latency1 = inst.op === "MUL.D" ? mulLatency : divLatency;
        mulRS[pos] = RSentry(
          inst.op,
          first1.flag ? first1.val : null,
          sec1.flag ? sec1.val : null,
          !first1.flag ? first1.qi : null,
          !sec1.flag ? sec1.qi : null,
          latency1,
          index
        );
        FPR[parseInt(inst.destination.slice(1))] = {
          qi: "M" + (pos + 1),
          val: FPR[parseInt(inst.destination.slice(1))].val,
        };
        if (!first1.flag) {
          key = first1.qi;
          noOfWaiting.set(
            key,
            noOfWaiting.has(key) ? noOfWaiting.get(key) + 1 : 1
          );
        }
        if (!sec1.flag) {
          key = sec1.qi;
          noOfWaiting.set(
            key,
            noOfWaiting.has(key) ? noOfWaiting.get(key) + 1 : 1
          );
        }
        break;

      case "L.D":
        pos = isEmpty(loadBuffer);
        if (pos === -1 || checkLoadClash(inst.address)) {
          return;
        }
        inst.issue = clk;
        isIssued = true;
        loadBuffer[pos] = loadEntry(inst.address, loadLatency, index);
        FPR[parseInt(inst.R1.slice(1))] = {
          qi: "L" + (pos + 1),
          val: FPR[parseInt(inst.R1.slice(1))].val,
        };
        break;

      case "S.D":
        pos = isEmpty(storeBuffer);
        if (
          pos === -1 ||
          checkStoreClash(inst.address) ||
          checkLoadClash(inst.address)
        ) {
          return;
        }
        inst.issue = clk;
        isIssued = true;
        let store = checkRF(FPR, inst.R1.slice(1));
        storeBuffer[pos] = storeEntry(
          store.flag ? store.val : null,
          !store.flag ? store.qi : null,
          inst.address,
          storeLatency,
          index
        );
        FPR[parseInt(inst.R1.slice(1))] = {
          qi: "S" + (pos + 1),
          val: FPR[parseInt(inst.destination.slice(1))].val,
        };
        if (!store.flag) {
          key = store.qi;
          noOfWaiting.set(
            key,
            noOfWaiting.has(key) ? noOfWaiting.get(key) + 1 : 1
          );
        }
        break;
    }
  }
  function getPriotity(tag) {
    let priority = 0;
    for (let i = 0; i < addRS.length; i++) {
      if (
        (addRS[i].qj === tag && addRS[i].qk == null) ||
        (addRS[i].qk === tag && addRS[i].qj == null)
      ) {
        priority++;
      } else if (addRS[i].qj === tag && addRS[i].qk === tag) {
        priority += 0.5;
      }
    }
    for (let i = 0; i < mulRS.length; i++) {
      if (
        (mulRS[i].qj === tag && mulRS[i].qk == null) ||
        (mulRS[i].qk === tag && mulRS[i].qj == null)
      ) {
        priority++;
      } else if (mulRS[i].qj === tag && mulRS[i].qk === tag) {
        priority += 0.5;
      }
    }
    for (let i = 0; i < storeBuffer.length; i++) {
      if (storeBuffer[i].qj === tag) {
        priority++;
      }
    }
    return priority;
  }

  function execute() {
    for (let i = 0; i < addRS.length; i++) {
      //console.log(addRS[i])
      if (addRS[i].status === "ready") {
        addRS[i].status = "executing";
      } else if (
        addRS[i].status === "executing" &&
        addRS[i].qj === null &&
        addRS[i].qk === null
      ) {
        let toComplete = addRS[i].op == "ADD.D" ? addLatency : subLatency;
        if (addRS[i].latency == toComplete)
          instructionQueue[addRS[i].instQueueIdx].executionComplete.i = clk;
        addRS[i].latency--;
        if (addRS[i].latency === 0) {
          instructionQueue[addRS[i].instQueueIdx].executionComplete.j = clk;
          addRS[i].status = "executed";
        }
      } else if (addRS[i].status === "executed") {
        let priority = getPriotity("A" + (i + 1));
        waitingsToWrite.enqueue(
          {
            instQueueIdx: addRS[i].instQueueIdx,
            val: addRS[i].vj + addRS[i].vk,
            qi: "A" + (i + 1),
          },
          priority
        );
        addRS[i].status = "writing";
      }
    }
    for (let i = 0; i < mulRS.length; i++) {
      // console.log(mulRS[i]);
      if (mulRS[i].status === "ready") {
        mulRS[i].status = "executing";
      } else if (
        mulRS[i].status === "executing" &&
        mulRS[i].qj === null &&
        mulRS[i].qk === null
      ) {
        let toComplete = mulRS[i].op == "MUL.D" ? mulLatency : divLatency;
        if (mulRS[i].latency == toComplete)
          instructionQueue[mulRS[i].instQueueIdx].executionComplete.i = clk;
        mulRS[i].latency--;
        if (mulRS[i].latency === 0) {
          //finished executing
          instructionQueue[mulRS[i].instQueueIdx].executionComplete.j = clk;
          mulRS[i].status = "executed";
        }
      } else if (mulRS[i].status === "executed") {
        let priority = getPriotity("M" + (i + 1));
        waitingsToWrite.enqueue(
          {
            instQueueIdx: mulRS[i].instQueueIdx,
            val: mulRS[i].vj * mulRS[i].vk,
            qi: "M" + (i + 1),
          },
          priority
        );
        mulRS[i].status = "writing";
      }
    }
    for (let i = 0; i < loadBuffer.length; i++) {
      loadBuffer[i];
      if (loadBuffer[i].status === "ready") {
        loadBuffer[i].status = "executing";
      } else if (loadBuffer[i].status === "executing") {
        if (loadBuffer[i].latency == loadLatency)
          instructionQueue[loadBuffer[i].instQueueIdx].executionComplete.i =
            clk;
        loadBuffer[i].latency--;
        if (loadBuffer[i].latency === 0) {
          //finished executing
          instructionQueue[loadBuffer[i].instQueueIdx].executionComplete.j =
            clk;
          loadBuffer[i].status = "executed";
        }
      } else if (loadBuffer[i].status === "executed") {
        let priority = getPriotity("L" + (i + 1));
        waitingsToWrite.enqueue(
          {
            instQueueIdx: loadBuffer[i].instQueueIdx,
            val: memory[loadBuffer[i].address],
            qi: "L" + (i + 1),
          },
          priority
        );
        loadBuffer[i].status = "writing";
      }
    }
    for (let i = 0; i < storeBuffer.length; i++) {
      if (storeBuffer[i].status === "ready") {
        storeBuffer[i].status = "executing";
      } else if (
        storeBuffer[i].status === "executing" &&
        storeBuffer[i].q === null
      ) {
        if (storeBuffer[i].latency == storeLatency)
          instructionQueue[storeBuffer[i].instQueueIdx].executionComplete.i =
            clk;
        storeBuffer[i].latency--;
        if (storeBuffer[i].latency === 0) {
          memory[storeBuffer[i].address] = storeBuffer[i].v;
          instructionQueue[storeBuffer[i].instQueueIdx].executionComplete.j =
            clk;
          storeBuffer[i].status = "executed";
        }
      }
    }
  }
  function WriteBack() {
    if (waitingsToWrite.isEmpty()) {
      return;
    }
    finisedItems++;
    let inst = waitingsToWrite.dequeue().element;
    instructionQueue[inst.instQueueIdx].writeResults = clk;
    noOfWaiting.set(inst.qi, 0);

    for (let i = 0; i < addRS.length; i++) {
      if (addRS[i].qj === inst.qi) {
        addRS[i].vj = inst.val;
        addRS[i].qj = null;
      }
      if (addRS[i].qk === inst.qi) {
        addRS[i].vk = inst.val;
        addRS[i].qk = null;
      }
    }
    for (let i = 0; i < mulRS.length; i++) {
      if (mulRS[i].qj === inst.qi) {
        mulRS[i].vj = inst.val;
        mulRS[i].qj = null;
      }
      if (mulRS[i].qk === inst.qi) {
        mulRS[i].vk = inst.val;
        mulRS[i].qk = null;
      }
    }
    for (let i = 0; i < storeBuffer.length; i++) {
      if (storeBuffer[i].q === inst.qi) {
        storeBuffer[i].v = inst.val;
        storeBuffer[i].q = null;
      }
    }
    for (let i = 0; i < FPR.length; i++) {
      if (FPR[i].qi === inst.qi) {
        FPR[i].val = inst.val;
        FPR[i].qi = 0;
      }
    }
    let letter = inst.qi[0];
    switch (letter) {
      case "A":
        addRS[parseInt(inst.qi.slice(1)) - 1] = 0;
        break;
      case "M":
        mulRS[parseInt(inst.qi.slice(1)) - 1] = 0;
        break;
      case "L":
        loadBuffer[parseInt(inst.qi.slice(1)) - 1] = 0;
        break;
      default:
        break;
    }
  }
  //let u = 0;
  /*notes
first check FIFO priority in the class
then check the priority of the instruction
test store
*/
  while (finisedItems < instructionQueue.length) {
    //u++
    if (pc < instructionQueue.length) {
      issue(pc);
      if (isIssued) {
        pc++;
        isIssued = false;
      }
    }
    execute();
    WriteBack();

    instructionQueueR.push(
      instructionQueue.map((a) => {
        return { ...a, i: a.executionComplete.i, j: a.executionComplete.j, d: a.R1 || a.destination };
      })
    );
    FPRR.push([...FPR]);
    storeBufferR.push([...storeBuffer]);
    loadBufferR.push([...loadBuffer]);
    addRSR.push([...addRS]);
    mulRSR.push([...mulRS]);

    clk++;
  }
  max = clk
};

run();
console.log(instructionQueueR);

const gridStyle = { maxHeight: 800 };

function InstructionQueueTable({ cycle }) {
  const columns = [
    { name: "op", header: "op", defaultFlex: 1 },
    { name: "d", header: "Destination", defaultFlex: 1 },
    { name: "source1", header: "Source 1", defaultFlex: 1 },
    { name: "source2", header: "Source 2", defaultFlex: 1 },
    // { name: "R1", header: "R1", defaultFlex: 1 },
    { name: "address", header: "Address", defaultFlex: 1 },
    { name: "issue", header: "Issue", defaultFlex: 1 },
    { name: "i", header: "Start Ex", defaultFlex: 1 },
    { name: "j", header: "End Ex", defaultFlex: 1, accessor: (row) => row.j },
    { name: "writeResults", header: "Write on CDB", defaultFlex: 1 },
  ];

  return (
    <ReactDataGrid
      theme="default-dark"
      idProperty="id"
      columns={columns}
      dataSource={instructionQueueR[cycle]}
      style={gridStyle}
    />
  );
}

function StoreBufferTable({ cycle }) {
  const columns = [
    { name: "op", header: "op", defaultFlex: 1 },
    { name: "source1", header: "Source 1", defaultFlex: 1 },
    { name: "source2", header: "Source 2", defaultFlex: 1 },
    { name: "R1", header: "R1", defaultFlex: 1 },
    { name: "address", header: "Address", defaultFlex: 1 },
    { name: "issue", header: "Issue", defaultFlex: 1 },
    { name: "writeResults", header: "Write on CDB", defaultFlex: 1 },
  ];

  return (
    <ReactDataGrid
      theme="default-dark"
      idProperty="id"
      columns={columns}
      dataSource={instructionQueueR[cycle]}
      style={gridStyle}
    />
  );
}

function LoadBufferTable({ cycle }) {
  const columns = [
    { name: "address", header: "Address", defaultFlex: 1 },
    { name: "status", header: "Status", defaultFlex: 1 },
  ];

  return (
    <ReactDataGrid
      theme="default-dark"
      idProperty="id"
      columns={columns}
      dataSource={loadBufferR[cycle]}
      style={gridStyle}
    />
  );
}

function AddRSTable({ cycle }) {
  const columns = [
    { name: "op", header: "op", defaultFlex: 1 },
    { name: "vj", header: "vj", defaultFlex: 1 },
    { name: "vk", header: "vk", defaultFlex: 1 },
    { name: "qj", header: "qj", defaultFlex: 1 },
    { name: "qk", header: "qk", defaultFlex: 1 },
    { name: "status", header: "Status", defaultFlex: 1 },
    { name: "writeResults", header: "Write on CDB", defaultFlex: 1 },
  ];

  return (
    <ReactDataGrid
      theme="default-dark"
      idProperty="id"
      columns={columns}
      dataSource={addRSR[cycle]}
      style={gridStyle}
    />
  );
}

function MulRSTable({ cycle }) {
  const columns = [
    { name: "op", header: "op", defaultFlex: 1 },
    { name: "vj", header: "vj", defaultFlex: 1 },
    { name: "vk", header: "vk", defaultFlex: 1 },
    { name: "qj", header: "qj", defaultFlex: 1 },
    { name: "qk", header: "qk", defaultFlex: 1 },
    { name: "status", header: "Status", defaultFlex: 1 },
    { name: "writeResults", header: "Write on CDB", defaultFlex: 1 },
  ];

  return (
    <ReactDataGrid
      theme="default-dark"
      idProperty="id"
      columns={columns}
      dataSource={mulRSR[cycle]}
      style={gridStyle}
    />
  );
}

function FPRTable({ cycle }) {
  const columns = [
    { name: "qi", header: "qi", defaultFlex: 1 },
    { name: "val", header: "val", defaultFlex: 1 },
  ];

  return (
    <ReactDataGrid
      theme="default-dark"
      idProperty="id"
      columns={columns}
      dataSource={FPRR[cycle]}
      style={gridStyle}
    />
  );
}
function App() {
  const [table, setTable] = useState(0);
  const [cycle, setCycle] = useState(0);

  const handelClick = (n) => {
    setTable(n);
  };

  const handleChange = (direction) => {

    if (direction === 1){ 
      if(cycle + 1 < max - 1)
        setCycle((prev) => prev + 1)
    }else{
      if(cycle - 1 >= 0)
        setCycle((prev) => prev - 1)

    }

  }

  return (
    <div className="App bg-black w-full h-full">
      <div className="w-full h-full flex flex-col items-center">
        <div className="w-8/12">
          {/* NAV */}
          <div className="mt-8">
            <ul className="hidden text-sm font-medium text-center text-t rounded-lg divide-x divide-gray-200 shadow sm:flex dark:divide-gray-700 dark:text-gray-400">
              <li className="w-full">
                <button
                  className={`inline-block p-4 w-full rounded-tl-md bg-white hover:text-gray-700 hover:bg-gray-50 focus:outline-none dark:hover:text-white dark:bg-b dark:hover:bg-a ${ table == 0 ? "dark:bg-a text-white" : "dark:bg-b"}`}
                  onClick={() => handelClick(0)}
                >
                  Instruction Queue
                </button>
              </li>
              <li className="w-full">
                <button
                  className={`inline-block p-4 w-full  bg-white hover:text-gray-700 hover:bg-gray-50 focus:outline-none dark:hover:text-white dark:bg-b dark:hover:bg-a ${ table == 1 ? "dark:bg-a text-white" : "dark:bg-b"}`}
                  
                  onClick={() => handelClick(1)}
                >
                  FPR
                </button>
              </li>
              <li className="w-full">
                <button
                  className={`inline-block p-4 w-full  bg-white hover:text-gray-700 hover:bg-gray-50 focus:outline-none dark:hover:text-white dark:bg-b dark:hover:bg-a ${ table == 2 ? "dark:bg-a text-white" : "dark:bg-b"}`}
                  
                  onClick={() => handelClick(2)}
                >
                  Store Buffer
                </button>
              </li>
              <li className="w-full">
                <button
                  className={`inline-block p-4 w-full  bg-white hover:text-gray-700 hover:bg-gray-50 focus:outline-none dark:hover:text-white dark:bg-b dark:hover:bg-a ${ table == 3 ? "dark:bg-a text-white" : "dark:bg-b"}`}
                  
                  onClick={() => handelClick(3)}
                >
                  Load Buffer
                </button>
              </li>
              <li className="w-full">
                <button
                  className={`inline-block p-4 w-full  bg-white hover:text-gray-700 hover:bg-gray-50 focus:outline-none dark:hover:text-white dark:bg-b dark:hover:bg-a ${ table == 4 ? "dark:bg-a text-white" : "dark:bg-b"}`}
                  
                  onClick={() => handelClick(4)}
                >
                  Add RS
                </button>
              </li>
              <li className="w-full">
                <button
                  className={`inline-block p-4 w-full rounded-tr-md bg-white hover:text-gray-700 hover:bg-gray-50 focus:outline-none dark:hover:text-white dark:bg-b dark:hover:bg-a ${ table == 5 ? "dark:bg-a text-white" : "dark:bg-b"}`}
                  
                  onClick={() => handelClick(5)}
                >
                  Mul RS
                </button>
              </li>
            </ul>
          </div>

          <div>
            {table == 0 ? <InstructionQueueTable cycle={cycle} /> : <></>}
            {table == 1 ? <FPRTable cycle={cycle} /> : <></>}
            {table == 2 ? <StoreBufferTable cycle={cycle} /> : <></>}
            {table == 3 ? <LoadBufferTable cycle={cycle} /> : <></>}
            {table == 4 ? <AddRSTable cycle={cycle} /> : <></>}
            {table == 5 ? <MulRSTable cycle={cycle} /> : <></>}
          </div>
          <div className="flex justify-end">

          <button onClick={() => handleChange(1)} className="px-4 py-2 bg-a rounded-md text-t hover:bg-b hover:text-white mr-2">
            Next cycle
          </button>
          <button onClick={() => handleChange(0)} className="px-4 py-2 bg-a rounded-md text-t  hover:bg-b hover:text-white">
            Previous cycle
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
