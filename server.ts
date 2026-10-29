import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { ApolloServer } from "@apollo/server";
import { ApolloServerPluginDrainHttpServer } from "@apollo/server/plugin/drainHttpServer";
import { expressMiddleware } from "@as-integrations/express5";

import { makeExecutableSchema } from "@graphql-tools/schema";
import { WebSocketServer } from "ws";
import { useServer } from "graphql-ws/use/ws";

import { PubSub } from "graphql-subscriptions";

const pubsub = new PubSub();

type Board = {
	id: string;
	name: string;
};

type Task = {
	id: string;
	title?: string;
	content: string[];
	image?: string;
	team: string;
	stage: string;
	boardId: string;
};

const boards: Board[] = [
	{ id: "board-1", name: "Website Redesign" },
	{ id: "board-2", name: "Mobile App" },
	{ id: "board-3", name: "Marketing Launch" },
];

const tasks: Task[] = [
	{
		id: "1",
		title: "Task 1",
		content: ["Set up initial routing"],
		team: "teamA",
		stage: "backlog",
		boardId: "board-1",
		image: "https://plus.unsplash.com/premium_photo-1720287601920-ee8c503af775?q=80&w=1740&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=NHwxMjA3fDA%3D",
	},
	{
		id: "2",
		content: ["Fix the header layout on mobile"],
		team: "teamA",
		stage: "backlog",
		boardId: "board-1",
	},
	{
		id: "3",
		title: "Task 3",
		content: ["Add validation to the login form"],
		team: "teamA",
		stage: "todo",
		boardId: "board-1",
	},
	{
		id: "4",
		title: "Push notifications",
		content: ["Pick a provider"],
		team: "teamB",
		stage: "inprogress",
		boardId: "board-2",
	},
	{
		id: "5",
		content: ["Design the onboarding screens"],
		team: "teamC",
		stage: "todo",
		boardId: "board-2",
	},
	{
		id: "6",
		title: "Launch email",
		content: ["Draft copy", "Get sign-off"],
		team: "teamA",
		stage: "staging",
		boardId: "board-3",
	},
];

const typeDefs = `#graphql

type Board {
	id: ID!
	name: String!
}

type Task {
id: ID!
title: String
content: [String!]!
image:String
team: String!
stage:String!
boardId: ID!
}

input CreateTaskInput {
title: String
content: [String!]!
image:String
team: String!
stage:String!
boardId: ID!
}

type Query {
  boards: [Board!]!
  tasks(boardId: ID!): [Task!]!
}

type Mutation {
  createTask(input: CreateTaskInput!): Task!
	 moveTask(id: ID!, team: String!, stage:String!): Task!
	 deleteTask(id:ID!): Task!
	 createBoard(name:String!): Board!
	 deleteBoard(id:ID!): Board!
}

type Subscription {
	taskUpdated: Task!
}


`;

const resolvers = {
	Query: {
		boards: () => boards,
		tasks: (_parent: unknown, args: { boardId: string }) =>
			tasks.filter((task) => task.boardId === args.boardId),
	},

	Subscription: {
		taskUpdated: {
			subscribe: () => pubsub.asyncIterableIterator("TASK UPDATED"),
		},
	},

	Mutation: {
		createTask: (_parent: unknown, args: { input: Omit<Task, "id"> }) => {
			const newTask = {
				id: crypto.randomUUID(),
				...args.input,
			};

			tasks.push(newTask);
			pubsub.publish("TASK UPDATED", { taskUpdated: newTask });
			return newTask;
		},

		createBoard: (_parent: unknown, args: { name: string }) => {
			const newBoard: Board = {
				id: `board-${Date.now()}`,
				name: args.name,
			};
			boards.push(newBoard);
			return newBoard;
		},

		deleteBoard: (_parent: unknown, args: { id: string }) => {
			const boardIndex = boards.findIndex((b) => b.id === args.id);
			if (boardIndex === -1) {
				throw new Error(`Board with ID ${args.id} not found`);
			}

			const [deletedBoard] = boards.splice(boardIndex, 1);

			for (let i = tasks.length - 1; i >= 0; i--) {
				if (tasks[i].boardId === args.id) {
					tasks.splice(i, 1);
				}
			}

			return deletedBoard;
		},

		deleteTask: (_parent: unknown, args: { id: string }) => {
			const taskIndex = tasks.findIndex((task) => task.id === args.id);

			if (taskIndex === -1) {
				throw new Error(`Task with ID ${args.id} not found`);
			}

			const [deletedTask] = tasks.splice(taskIndex, 1);
			pubsub.publish("TASK UPDATED", { taskUpdated: deletedTask });
			return deletedTask;
		},

		moveTask: (
			_parent: unknown,
			args: { id: string; team: string; stage: string },
		) => {
			const task = tasks.find((t) => t.id === args.id);
			if (!task) throw new Error(`Task with id ${args.id} not found`);
			task.team = args.team;
			task.stage = args.stage;
			pubsub.publish("TASK UPDATED", { taskUpdated: task });
			return task;
		},
	},
};

const app = express();
const httpServer = createServer(app);

const schema = makeExecutableSchema({ typeDefs, resolvers });

const wsServer = new WebSocketServer({
	server: httpServer,
	path: "/graphql",
});

const serverCleanup = useServer({ schema }, wsServer);

const server = new ApolloServer({
	schema,
	plugins: [
		ApolloServerPluginDrainHttpServer({ httpServer }),
		{
			async serverWillStart() {
				return {
					async drainServer() {
						await serverCleanup.dispose();
					},
				};
			},
		},
	],
});

await server.start();

const allowedOrigins = [
	"http://localhost:5173",
	"https://hilarious-lollipop-855ffc.netlify.app/",
];

app.use(
	"/graphql",
	cors({
		origin: allowedOrigins,
	}),
	express.json(),
	expressMiddleware(server),
);

const PORT = process.env.PORT || 4000;

httpServer.listen(PORT, () => {
	console.log(`🚀 Server ready on port ${PORT}`);
});
