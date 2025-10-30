// runAlgo.js
require('dotenv').config(); // optional: reads .env if present

// prefer local ./tl, fall back to npm 'tradelayer'
let ApiWrapper = require('./tl/algoAPI.js'); // catch { ApiWrapper = require('tradelayer'); }

const toBool = (v, d=false) =>
  v === undefined ? d :
  ['1','true','yes','on'].includes(String(v).trim().toLowerCase());

const required = (name, def) => {
  const v = process.env[name] ?? def;
  if (v === undefined || v === '') {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
};

function uiLog(...args) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  self.postMessage({ type: 'log', msg });
  uiLog(...args); // still logs to worker console too
}


// ---- ENV CONFIG ----
const HOST     = required('TL_HOST', '172.81.181.19'); // includes ws:// ws://172.26.37.103
const PORT     = Number(process.env.TL_PORT ?? 3001);
const TESTNET  = toBool(process.env.TL_TEST, true);          // true | false
const TL_ON    = toBool(process.env.TL_TLON, false);          // your "tlAlreadyOn"
const ADDRESS  = 'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf' //required('TL_ADDRESS', 'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf');
const PUBKEY   = '03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677' //required('TL_PUBKEY',  '03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677');
const NETWORK  = required('TL_NETWORK', 'LTCTEST');          // e.g., LTCTEST | BTCTEST | LTC
const SIZE = required('SIZE', 0.1)
uiLog('env config '+HOST+' '+PORT+' '+TESTNET+' '+TL_ON+' '+ADDRESS+' '+PUBKEY+' '+NETWORK)

// ---- INIT ----
const api = new ApiWrapper(HOST, PORT, TESTNET, TL_ON, ADDRESS, PUBKEY, NETWORK);

(async () => {
  //uiLog('[cfg]', { HOST, PORT, TESTNET, TL_ON, ADDRESS, NETWORK });

  await api.delay(1500);

  const me = api.getMyInfo();
  uiLog('me:', me.address);

  const spot = await api.getSpotMarkets();
  uiLog('spot:', Array.isArray(spot) ? spot.length : 0);

  const ob = await api.getOrderbookData({ type: 'SPOT', first_token: 0, second_token: 5 });
  uiLog('orderbook levels:', { bids: ob?.bids?.length || 0, asks: ob?.asks?.length || 0 });

  const order = {
    type: 'SPOT',
    action: 'BUY',
    isLimitOrder: true,
    keypair: { address: 'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf' /*ADDRESS*/, pubkey: '03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677'/*PUBKEY*/ },
    props: { id_for_sale: 0, id_desired: 5, price: 100, amount: SIZE, transfer: false }
  };

  const uuid = await api.sendOrder(order);
  uiLog('order sent:', uuid);
})().catch(e => {
  console.error('[fatal]', e);
  process.exit(1);
});
