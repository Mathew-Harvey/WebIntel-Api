/**
 * WebIntel MCP Server
 * 
 * Wraps the WebIntel REST API as MCP tools so Claude and other
 * LLMs can call link_preview and take_screenshot natively.
 * 
 * Usage:
 *   node mcp/server.js
 * 
 * Configure in Claude Desktop / claude.ai:
 *   {
 *     "mcpServers": {
 *       "webintel": {
 *         "command": "node",
 *         "args": ["path/to/mcp/server.js"],
 *         "env": {
 *           "WEBINTEL_API_KEY": "wi_your_key_here",
 *           "WEBINTEL_BASE_URL": "https://your-deploy.onrender.com"
 *         }
 *       }
 *     }
 *   }
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

const API_KEY = process.env.WEBINTEL_API_KEY || '';
const BASE_URL = (process.env.WEBINTEL_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

// --- Tool Definitions ---

const TOOLS = [
  {
    name: 'link_preview',
    description:
      'Extract Open Graph metadata, Twitter Card data, title, description, ' +
      'favicon, and other meta information from any URL. Useful for getting ' +
      'a summary of what a web page contains without loading the full content.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to extract preview data from (must include https://)'
        }
      },
      required: ['url']
    }
  },
  {
    name: 'take_screenshot',
    description:
      'Capture a screenshot of any web page. Returns the screenshot as a ' +
      'base64-encoded image with metadata including page title, dimensions, ' +
      'and file size. Useful for visual verification, documentation, or ' +
      'showing what a website looks like.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to screenshot (must include https://)'
        },
        width: {
          type: 'number',
          description: 'Viewport width in pixels (default 1280, max 1920)'
        },
        height: {
          type: 'number',
          description: 'Viewport height in pixels (default 800, max 1080)'
        },
        format: {
          type: 'string',
          enum: ['png', 'jpeg', 'webp'],
          description: 'Image format (default png)'
        },
        fullPage: {
          type: 'boolean',
          description: 'Capture full scrollable page instead of just the viewport'
        },
        darkMode: {
          type: 'boolean',
          description: 'Emulate dark mode / prefers-color-scheme: dark'
        }
      },
      required: ['url']
    }
  }
];

// --- API Caller ---

async function callApi(endpoint, params = {}) {
  const queryString = new URLSearchParams(params).toString();
  const url = `${BASE_URL}${endpoint}?${queryString}`;

  const response = await fetch(url, {
    headers: {
      'x-api-key': API_KEY,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(`API error ${response.status}: ${error.message || response.statusText}`);
  }

  return response.json();
}

// --- MCP Server Setup ---

const server = new Server(
  {
    name: 'webintel',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'link_preview': {
        if (!args.url) throw new Error('url is required');
        const result = await callApi('/v1/preview', { url: args.url });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result.data, null, 2)
            }
          ]
        };
      }

      case 'take_screenshot': {
        if (!args.url) throw new Error('url is required');
        const params = {
          url: args.url,
          response: 'json', // Always get JSON for MCP
          ...(args.width && { width: args.width }),
          ...(args.height && { height: args.height }),
          ...(args.format && { format: args.format }),
          ...(args.fullPage !== undefined && { fullPage: args.fullPage }),
          ...(args.darkMode !== undefined && { darkMode: args.darkMode })
        };
        const result = await callApi('/v1/screenshot', params);

        // Return metadata as text + image as embedded content
        const { image, ...metadata } = result.data;

        const content = [
          {
            type: 'text',
            text: JSON.stringify(metadata, null, 2)
          }
        ];

        // If the image data is present, include it
        if (image) {
          const commaIdx = image.indexOf(',');
          if (commaIdx !== -1) {
            const header = image.slice(0, commaIdx);
            const base64Data = image.slice(commaIdx + 1);
            const mimeMatch = header.match(/data:(image\/\w+);/);
            const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

            content.push({
              type: 'image',
              data: base64Data,
              mimeType
            });
          }
        }

        return { content };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`
        }
      ],
      isError: true
    };
  }
});

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[webintel-mcp] Server running on stdio');
}

main().catch((error) => {
  console.error('[webintel-mcp] Fatal error:', error);
  process.exit(1);
});
