//place for tunable stuff (parameters etc)

export const settings = {
  get supplierServiceUrl() { return process.env.SUPPLIER_SERVICE_URL ?? "http://localhost:3002"; },
  get creditServiceUrl() { return process.env.CREDIT_SERVICE_URL ?? "http://localhost:3004"; },
  get rabbitmqUrl() { return process.env.RABBITMQ_URL ?? "";}
}
