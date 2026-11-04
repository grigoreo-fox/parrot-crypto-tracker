describe('test infrastructure', () => {
  it('runs compiled TypeScript on a supported Node.js version', () => {
    const major: number = Number(process.versions.node.split('.')[0]);
    expect(major).toBeGreaterThanOrEqual(18);
  });
});
