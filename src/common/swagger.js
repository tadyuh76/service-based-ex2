const swaggerUi = require("swagger-ui-express");

function mountSwagger(app, document) {
  app.get("/swagger.json", (req, res) => {
    res.json(document);
  });

  app.use(
    "/swagger",
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: document.info.title,
      swaggerOptions: {
        persistAuthorization: true
      }
    })
  );
}

function baseDocument({ title, description, port, paths, schemas = {} }) {
  return {
    openapi: "3.0.3",
    info: {
      title,
      version: "1.0.0",
      description
    },
    servers: [
      {
        url: `http://localhost:${port}`
      }
    ],
    paths,
    components: {
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            message: { type: "string" },
            details: { type: "object", nullable: true }
          }
        },
        ...schemas
      }
    }
  };
}

function jsonResponse(description, schemaRef) {
  return {
    description,
    content: {
      "application/json": {
        schema: schemaRef
      }
    }
  };
}

module.exports = {
  mountSwagger,
  baseDocument,
  jsonResponse
};
