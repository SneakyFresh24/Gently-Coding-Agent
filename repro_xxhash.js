try {
    const { XXHash64 } = require('xxhash-addon');
    console.log('Testing XXHash64 with 19-byte seed...');
    const hasher = new XXHash64(Buffer.from('gently-retrieval-v1'));
    console.log('XXHash64 success!');
} catch (e) {
    console.error('Caught error (XXHash64):', e.message);
}

try {
    const { XXHash64 } = require('xxhash-addon');
    console.log('\nTesting XXHash64 with 8-byte seed...');
    const hasher = new XXHash64(Buffer.alloc(8));
    console.log('XXHash64 (8-byte) success!');
} catch (e) {
    console.error('Caught error (XXHash64 8-byte):', e.message);
}
