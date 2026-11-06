window.onload = function () {
  window.ui = SwaggerUIBundle({
    url: '/docs/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    persistAuthorization: false,
    validatorUrl: null
  });
};
