import request from 'supertest';
import { createApp } from '../src/app';

describe('public API documentation', () => {
  const app = createApp({ checkDatabase: () => {} });
  it('serves the UI and its assets without authentication', async () => {
    const html = await request(app).get('/docs');
    expect(html.status).toBe(200);
    expect(html.text).toContain('/docs/swagger-ui-bundle.js');
    expect(html.text).toContain('/docs/init.js');
    for (const path of ['/docs/swagger-ui.css', '/docs/swagger-ui-bundle.js', '/docs/init.js']) {
      expect((await request(app).get(path)).status).toBe(200);
    }
    const init = await request(app).get('/docs/init.js');
    expect(init.text).toContain('persistAuthorization: false');
    expect(init.text).toContain('validatorUrl: null');
  });
  it('serves the bundled OpenAPI contract', async () => {
    const response = await request(app).get('/docs/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.3');
    expect(response.body.paths['/v1/cryptocurrency/map']).toBeDefined();
  });
});
