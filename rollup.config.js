export default {
    input: 'src/index.js',
    output: {
        file: 'dist/index.js',
        format: 'cjs',
        strict: false,
        esModule: false,
    },
    external: ['fs', 'http', 'readline', 'child_process'],
    plugins: [],
};
