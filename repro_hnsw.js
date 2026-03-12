const hnswlib = require('hnswlib-node');

try {
    console.log('Testing HNSW initialization...');
    const index = new hnswlib.HierarchicalNSW('cosine', 384);
    console.log('Index created, calling initIndex with positional args...');
    index.initIndex(10000, 16, 200, 100);
    console.log('initIndex success!');
} catch (e) {
    console.error('Caught error (positional):', e.message);
}

try {
    console.log('\nTesting HNSW initialization with options object...');
    const index2 = new hnswlib.HierarchicalNSW('cosine', 384);
    index2.initIndex({
        maxElements: 10000,
        m: 16,
        efConstruction: 200,
        randomSeed: 100
    });
    console.log('initIndex (options) success!');
} catch (e) {
    console.error('Caught error (options):', e.message);
}

try {
    console.log('\nTesting HNSW initialization without seed...');
    const index3 = new hnswlib.HierarchicalNSW('cosine', 384);
    index3.initIndex(10000, 16, 200);
    console.log('initIndex (no seed) success!');
} catch (e) {
    console.error('Caught error (no seed):', e.message);
}
