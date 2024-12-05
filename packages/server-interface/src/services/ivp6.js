const fastify = require('fastify')();

fastify.post('/api/endpoint', async (request, reply) => {
  // Handle API requests
  reply.send({ message: 'Response from desktop client API' });
});

// Bind to IPv6 or IPv4 interface
const bindAddress = process.env.IPV6_ENABLED ? '::' : '0.0.0.0';
fastify.listen(3000, bindAddress, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`API server running at ${address}`);
});

const axios = require('axios');

async function registerWithDirectory(apiEndpoint, metadata) {
  try {
    const response = await axios.post('https://directory-server.example.com/register', {
      endpoint: apiEndpoint,
      metadata: metadata,
    });
    console.log('Registered with directory:', response.data);
  } catch (error) {
    console.error('Error registering with directory:', error.message);
  }
}

const apiEndpoint = 'http://[::1]:3000'; // IPv6 address or IPv4 fallback
const metadata = { name: 'User Node', supportedFeatures: ['tx-broadcast', 'query'] };
registerWithDirectory(apiEndpoint, metadata);

const Libp2p = require('libp2p');
const { NOISE } = require('@chainsafe/libp2p-noise');
const WebSockets = require('@libp2p/websockets');
const Mplex = require('@libp2p/mplex');
const Bootstrap = require('@libp2p/bootstrap');

const node = await Libp2p.create({
  addresses: {
    listen: ['/ip6/::/tcp/0/ws'], // Listen on IPv6
  },
  modules: {
    transport: [WebSockets],
    connEncryption: [NOISE],
    streamMuxer: [Mplex],
    peerDiscovery: [Bootstrap],
  },
  config: {
    peerDiscovery: {
      bootstrap: {
        list: ['/ip4/127.0.0.1/tcp/4001/ws/p2p/QmPeerID'],
      },
    },
  },
});

node.start();
console.log('Node started:', node.peerId.toB58String());

node.handle('/custom-protocol', ({ stream }) => {
  // Handle incoming requests
  console.log('Received stream:', stream);
});
