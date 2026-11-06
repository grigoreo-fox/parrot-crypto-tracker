import request from 'supertest';
import { createApp } from '../src/app';

describe('public UI', () => {
  const app = createApp({ checkDatabase: () => {} });
  it('serves the page and local assets without a token', async () => {
    const page = await request(app).get('/');
    expect(page.status).toBe(200);
    expect(page.text).toContain('/ui/app.js');
    expect(page.text).toContain('id="token"');
    expect((await request(app).get('/ui/style.css')).status).toBe(200);
    const script = await request(app).get('/ui/app.js');
    expect(script.status).toBe(200);
    expect(script.text).not.toMatch(/localStorage|sessionStorage/);
    expect(script.text).toContain('https://s2.coinmarketcap.com/static/img/coins/64x64/');
    expect(page.text).not.toContain('Цены без шума');
  });
});
