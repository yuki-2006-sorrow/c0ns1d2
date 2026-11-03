import {parentPort,workerData} from 'node:worker_threads';
import {extractMaterial} from './material-extract.mjs';
try{parentPort.postMessage({result:await extractMaterial(workerData.bytes,workerData.name)});}catch(error){parentPort.postMessage({error:error.message});}
