import express from "express";
import crypto from "node:crypto";
import { SSMClient, GetParametersByPathCommand } from "@aws-sdk/client-ssm";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";

// código gerado pelo claude e revisado por mim para fazer esta atividade

// Config vem do SSM, não do código
const ssm = new SSMClient({});
const { Parameters } = await ssm.send(new GetParametersByPathCommand({ Path: "/linkpulse/" }));
const cfg = Object.fromEntries(Parameters.map(p => [p.Name.split("/").pop(), p.Value]));

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});
const app = express();
app.use(express.json());

// Health check 
app.get("/health", (_req, res) => res.send("ok"));

// Cria link curto
app.post("/api/links", async (req, res) => {
  const code = crypto.randomBytes(4).toString("base64url").slice(0, 6);
  await ddb.send(new PutCommand({
    TableName: cfg["table-name"],
    Item: { code, url: req.body.url, clicks: 0, createdAt: Date.now() }
  }));
  res.status(201).json({ code });
});

// Estatísticas
app.get("/api/links/:code", async (req, res) => {
  const { Item } = await ddb.send(new GetCommand({ TableName: cfg["table-name"], Key: { code: req.params.code } }));
  Item ? res.json(Item) : res.sendStatus(404);
});

// Gasta CPU de propósito, pra testar o autoscaling
app.get("/api/burn", (_req, res) => {
  const end = Date.now() + 300;
  while (Date.now() < end) Math.sqrt(Math.random());
  res.send("burned");
});

// Redirect: responde rápido e manda o clique para a fila
app.get("/:code", async (req, res) => {
  const { Item } = await ddb.send(new GetCommand({ TableName: cfg["table-name"], Key: { code: req.params.code } }));
  if (!Item) return res.sendStatus(404);
  sqs.send(new SendMessageCommand({
    QueueUrl: cfg["queue-url"],
    MessageBody: JSON.stringify({ code: Item.code })
  })).catch(console.error);
  res.redirect(302, Item.url);
});

// Worker: consome a fila e soma o clique de forma atômica
async function worker() {
  while (true) {
    try {
      const { Messages = [] } = await sqs.send(new ReceiveMessageCommand({
        QueueUrl: cfg["queue-url"], MaxNumberOfMessages: 10, WaitTimeSeconds: 20
      }));
      for (const m of Messages) {
        const { code } = JSON.parse(m.Body);
        await ddb.send(new UpdateCommand({
          TableName: cfg["table-name"], Key: { code },
          UpdateExpression: "ADD clicks :one", ExpressionAttributeValues: { ":one": 1 }
        }));
        await sqs.send(new DeleteMessageCommand({ QueueUrl: cfg["queue-url"], ReceiptHandle: m.ReceiptHandle }));
      }
    } catch (e) { console.error(e); await new Promise(r => setTimeout(r, 2000)); }
  }
}
worker();

app.listen(process.env.PORT || 3000, () => console.log("up"));