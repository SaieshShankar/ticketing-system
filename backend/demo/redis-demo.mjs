import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  lazyConnect: true,
  connectTimeout: 3000,
  maxRetriesPerRequest: 0,
  retryStrategy: () => null,
});
redis.on('error', () => {});
const key = 'dbms-demo:ticket:HELP-0001';

async function run(label, command, ...args) {
  const result = await redis.call(command, ...args);
  console.log(`${label}\n> ${command} ${args.join(' ')}\n${result}\n`);
}

try {
  await redis.connect();
  await run('Create document', 'SET', key, JSON.stringify({ title: 'Printer is offline', priority: 'High' }));
  await run('Read document', 'GET', key);
  await run('Update document', 'SET', key, JSON.stringify({ title: 'Printer is offline', priority: 'Critical' }));
  await run('Read updated document', 'GET', key);
  await run('Delete document', 'DEL', key);
  await run('Confirm deletion', 'EXISTS', key);
  await run('Application cache creation', 'SET', 'dbms-demo:summary:helpdesk', JSON.stringify({ total: 1, open: 1 }), 'EX', '60');
  await run('Application cache read', 'GET', 'dbms-demo:summary:helpdesk');
  await run('Application cache invalidation', 'DEL', 'dbms-demo:summary:helpdesk');
} catch (error) {
  console.error(`Redis demonstration could not run: ${error.message}`);
  process.exitCode = 1;
} finally {
  redis.disconnect();
}
