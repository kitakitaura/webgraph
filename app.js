(() => {
  "use strict";

  const canvas = document.getElementById("graphCanvas");
  const ctx = canvas.getContext("2d");
  const miniMap = document.getElementById("miniMap");
  const miniCtx = miniMap.getContext("2d");

  const els = {
    app: document.querySelector(".app"),
    urlForm: document.getElementById("urlForm"),
    urlInput: document.getElementById("urlInput"),
    siteTitle: document.getElementById("siteTitle"),
    siteSummary: document.getElementById("siteSummary"),
    performanceScore: document.getElementById("performanceScore"),
    riskScore: document.getElementById("riskScore"),
    stackChips: document.getElementById("stackChips"),
    statsGrid: document.getElementById("statsGrid"),
    filters: document.getElementById("filters"),
    clusterList: document.getElementById("clusterList"),
    searchInput: document.getElementById("searchInput"),
    inspector: document.getElementById("inspector"),
    inspectorContent: document.getElementById("inspectorContent"),
    closeInspector: document.getElementById("closeInspector"),
    timelineList: document.getElementById("timelineList"),
    replayButton: document.getElementById("replayButton"),
    pauseButton: document.getElementById("pauseButton"),
    speedRange: document.getElementById("speedRange"),
    reverseToggle: document.getElementById("reverseToggle"),
    exportFormat: document.getElementById("exportFormat"),
    exportButton: document.getElementById("exportButton"),
    fitButton: document.getElementById("fitButton"),
    contextMenu: document.getElementById("contextMenu"),
    toast: document.getElementById("toast")
  };

  const typeColor = {
    page: "#4ea1ff",
    api: "#56f0a4",
    image: "#a56cff",
    video: "#ffad4d",
    pdf: "#f4f7ff",
    css: "#46e3ff",
    js: "#ffd166",
    font: "#f78fb3",
    cdn: "#8fd3ff",
    external: "#ffad4d",
    service: "#d2f078",
    analytics: "#ff7ac8",
    social: "#7aa2ff",
    subdomain: "#64f4d4",
    error: "#ff5a72",
    redirect: "#f4f7ff",
    hidden: "#b8f7d4",
    tracking: "#ff7ac8"
  };

  const edgeColor = {
    internal: "#4ea1ff",
    api: "#56f0a4",
    asset: "#a56cff",
    external: "#ffad4d",
    error: "#ff5a72",
    redirect: "#f4f7ff"
  };

  const typeLabel = {
    page: "PG",
    api: "API",
    image: "IMG",
    video: "VID",
    pdf: "PDF",
    css: "CSS",
    js: "JS",
    font: "FNT",
    cdn: "CDN",
    external: "EXT",
    service: "SVC",
    analytics: "AN",
    social: "SOC",
    subdomain: "SUB",
    error: "ERR",
    redirect: "301",
    hidden: "HID",
    tracking: "TRK"
  };

  const layerDefs = [
    { id: "page", name: "Pages", types: ["page"] },
    { id: "api", name: "APIs", types: ["api"] },
    { id: "image", name: "Images", types: ["image"] },
    { id: "video", name: "Videos", types: ["video"] },
    { id: "js", name: "Scripts", types: ["js"] },
    { id: "css", name: "CSS", types: ["css"] },
    { id: "external", name: "External Domains", types: ["external", "social", "cdn"] },
    { id: "service", name: "Third-party Services", types: ["service", "analytics", "tracking"] },
    { id: "tracking", name: "Tracking", types: ["tracking", "analytics"] },
    { id: "error", name: "Errors", types: ["error"] },
    { id: "redirect", name: "Redirects", types: ["redirect"] },
    { id: "font", name: "Fonts", types: ["font"] },
    { id: "pdf", name: "PDFs", types: ["pdf"] },
    { id: "hidden", name: "Hidden Endpoints", types: ["hidden"] },
    { id: "subdomain", name: "Subdomains", types: ["subdomain"] }
  ];

  const statDefs = [
    { key: "page", label: "Pages", types: ["page"] },
    { key: "api", label: "APIs", types: ["api"] },
    { key: "image", label: "Images", types: ["image"] },
    { key: "video", label: "Videos", types: ["video"] },
    { key: "js", label: "Scripts", types: ["js"] },
    { key: "font", label: "Fonts", types: ["font"] },
    { key: "requests", label: "Requests", edge: true },
    { key: "external", label: "External", types: ["external", "social", "service", "analytics", "tracking", "cdn"] },
    { key: "subdomain", label: "Subdomains", types: ["subdomain"] }
  ];

  const state = {
    nodes: [],
    edges: [],
    nodeById: new Map(),
    edgeById: new Map(),
    timeline: [],
    host: "google.com",
    origin: "https://google.com",
    seed: 1,
    rand: Math.random,
    metadata: null,
    width: 1,
    height: 1,
    dpr: 1,
    time: 0,
    lastTime: 0,
    layout: "organic",
    camera: { x: 0, y: 0, zoom: 0.72, targetX: 0, targetY: 0, targetZoom: 0.72 },
    pointer: { x: 0, y: 0, downX: 0, downY: 0, worldX: 0, worldY: 0 },
    pan: null,
    dragNode: null,
    hoverId: null,
    selectedId: null,
    contextNodeId: null,
    activeFilters: new Set(layerDefs.map((layer) => layer.id)),
    collapsedClusters: new Set(),
    searchIds: new Set(),
    highlightLabel: "",
    displayedStats: {},
    currentStats: {},
    statEls: new Map(),
    liveSource: null,
    liveFallbackTimer: 0,
    layoutFrame: 0,
    clusterFrame: 0,
    statsFrame: 0,
    lastClusterSignature: "",
    render: {
      nodes: [],
      nodeIds: new Set(),
      points: new Map(),
      edges: [],
      highVolume: false
    },
    frame: 0,
    scan: {
      version: 0,
      index: 0,
      active: false,
      paused: false,
      reverse: false,
      speed: 1,
      handle: 0
    },
    autoFollow: true,
    miniDrag: false
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const esc = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function mulberry32(seed) {
    return function random() {
      let t = (seed += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function choice(items) {
    return items[Math.floor(state.rand() * items.length)];
  }

  function normalizeUrl(raw) {
    const trimmed = raw.trim();
    const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withScheme);
    parsed.hash = "";
    return parsed;
  }

  function safeFilePart(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "webgraph";
  }

  function layerForType(type) {
    const found = layerDefs.find((layer) => layer.types.includes(type));
    return found ? found.id : type;
  }

  function resize() {
    state.dpr = Math.min(1.35, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    state.width = Math.max(320, rect.width);
    state.height = Math.max(520, rect.height);
    canvas.width = Math.floor(state.width * state.dpr);
    canvas.height = Math.floor(state.height * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    const miniRect = miniMap.getBoundingClientRect();
    miniMap.width = Math.floor(miniRect.width * state.dpr);
    miniMap.height = Math.floor(miniRect.height * state.dpr);
    miniCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  function buildGraph(rawUrl) {
    const parsed = normalizeUrl(rawUrl);
    const host = parsed.hostname.replace(/^www\./, "");
    state.host = host;
    state.origin = parsed.origin;
    state.seed = hashString(host + parsed.pathname);
    state.rand = mulberry32(state.seed);
    state.nodes = [];
    state.edges = [];
    state.nodeById = new Map();
    state.edgeById = new Map();
    state.timeline = [];
    state.selectedId = null;
    state.hoverId = null;
    state.contextNodeId = null;
    state.searchIds.clear();
    state.collapsedClusters.clear();
    state.highlightLabel = "";

    let nodeCount = 0;
    let edgeCount = 0;

    const addNode = (type, path, title, cluster, parentId, extras = {}) => {
      const id = extras.id || `${type}-${nodeCount += 1}`;
      const parent = parentId ? state.nodeById.get(parentId) : null;
      const angle = state.rand() * Math.PI * 2;
      const distance = parent ? 55 + state.rand() * 45 : 0;
      const node = {
        id,
        type,
        layer: layerForType(type),
        title,
        path,
        url: path.startsWith("http") ? path : `${state.origin}${path}`,
        cluster,
        parentId,
        depth: parent ? parent.depth + 1 : 0,
        status: extras.status || (type === "error" ? choice([401, 403, 404, 500]) : type === "redirect" ? 301 : 200),
        contentType: extras.contentType || contentTypeFor(type),
        size: extras.size || Math.round(2 + state.rand() * 980),
        loadTime: extras.loadTime || Math.round(28 + state.rand() * 1200),
        headers: extras.headers || headersFor(type, host),
        hidden: false,
        pinned: false,
        discovered: false,
        birth: 0,
        visits: 0,
        alpha: 0,
        x: parent ? parent.x + Math.cos(angle) * distance : 0,
        y: parent ? parent.y + Math.sin(angle) * distance : 0,
        z: parent ? (state.rand() - 0.5) * 100 : 0,
        vx: 0,
        vy: 0,
        vz: 0,
        tx: 0,
        ty: 0,
        tz: 0,
        radius: radiusFor(type),
        order: state.nodes.length,
        keywords: extras.keywords || []
      };
      state.nodes.push(node);
      state.nodeById.set(id, node);
      return node;
    };

    const addEdge = (source, target, type, label = "") => {
      const edge = {
        id: `edge-${edgeCount += 1}`,
        source: typeof source === "string" ? source : source.id,
        target: typeof target === "string" ? target : target.id,
        type,
        label,
        discovered: false,
        birth: 0,
        seed: state.rand()
      };
      state.edges.push(edge);
      state.edgeById.set(edge.id, edge);
      return edge;
    };

    const root = addNode("page", "/", host, "Core Pages", null, {
      id: "root",
      keywords: ["home", "root", "index"]
    });

    const pagePool = [
      ["About", "/about"],
      ["Products", "/products"],
      ["Pricing", "/pricing"],
      ["Docs", "/docs"],
      ["Blog", "/blog"],
      ["Customers", "/customers"],
      ["Contact", "/contact"],
      ["Login", "/login"],
      ["Dashboard", "/dashboard"],
      ["Careers", "/careers"],
      ["Privacy", "/legal/privacy"],
      ["Status", "/status"],
      ["Changelog", "/changelog"],
      ["Developers", "/developers"]
    ];
    const pageTotal = 9 + Math.floor(state.rand() * 5);
    const pages = pagePool.slice(0, pageTotal).map(([title, path]) => {
      const page = addNode("page", path, title, "Core Pages", root.id, keywordsForPage(title, path));
      addEdge(root, page, "internal", "link");
      return page;
    });

    const subdomains = [
      [`api.${host}`, `https://api.${host}`],
      [`assets.${host}`, `https://assets.${host}`],
      [`auth.${host}`, `https://auth.${host}`],
      [`status.${host}`, `https://status.${host}`]
    ].map(([title, url]) => {
      const node = addNode("subdomain", url, title, "Subdomains", root.id, {
        contentType: "text/html",
        keywords: ["subdomain", title.split(".")[0]]
      });
      addEdge(root, node, "internal", "dns");
      return node;
    });

    const apiParent = pages.find((page) => page.path === "/products") || pages[0];
    const apiNodes = [
      ["Products API", "/api/products", ["product", "catalog", "list"]],
      ["Search API", "/api/search?q=webgraph", ["search", "pagination", "query"]],
      ["Session API", "/api/auth/session", ["auth", "login", "session"]],
      ["Login API", "/api/auth/login", ["auth", "login", "oauth"]],
      ["Pricing API", "/api/pricing", ["pricing", "plans"]],
      ["Pagination API", "/api/products?cursor=eyJwYWdlIjoyfQ", ["pagination", "cursor", "product"]],
      ["GraphQL", "/graphql", ["graphql", "api", "schema"]],
      ["Checkout API", "/v1/checkout", ["stripe", "checkout", "payment"]],
      ["Feed JSON", "/feed.json", ["feed", "json", "content"]]
    ].map(([title, path, keywords], index) => {
      const parent = index < 4 ? apiParent : choice(pages);
      const api = addNode("api", path, title, "Internal APIs", parent.id, {
        contentType: path.includes("graphql") ? "application/graphql-response+json" : "application/json",
        keywords
      });
      addEdge(parent, api, "api", "request");
      if (subdomains[0]) addEdge(subdomains[0], api, "api", "origin");
      return api;
    });

    const assetNodes = [
      ["Runtime Bundle", `/assets/runtime.${state.seed.toString(16).slice(0, 6)}.js`, "js", ["script", "bundle"]],
      ["App Bundle", `/assets/app.${(state.seed * 13).toString(16).slice(0, 6)}.js`, "js", ["script", "app"]],
      ["Design System", `/assets/styles.${(state.seed * 17).toString(16).slice(0, 6)}.css`, "css", ["css", "styles"]],
      ["Theme CSS", "/assets/theme.css", "css", ["css", "theme"]],
      ["Hero Image", "/images/hero.webp", "image", ["image", "hero", "cdn"]],
      ["Product Gallery", "/images/products/grid.avif", "image", ["image", "product", "cdn"]],
      ["Demo Video", "/media/product-demo.mp4", "video", ["video", "demo"]],
      ["Inter Variable", "/fonts/inter-var.woff2", "font", ["font", "typography"]],
      ["Whitepaper", "/downloads/platform-overview.pdf", "pdf", ["pdf", "whitepaper"]]
    ].map(([title, path, type, keywords], index) => {
      const parent = index < 4 ? root : choice(pages);
      const asset = addNode(type, path, title, "Static Assets", parent.id, {
        contentType: contentTypeFor(type),
        keywords
      });
      addEdge(parent, asset, "asset", type);
      if (subdomains[1] && ["image", "video", "font"].includes(type)) {
        addEdge(subdomains[1], asset, "asset", "cdn");
      }
      return asset;
    });

    pages.slice(0, 7).forEach((page) => {
      const asset = choice(assetNodes);
      addEdge(page, asset, "asset", "reuse");
      if (state.rand() > 0.42) addEdge(page, choice(apiNodes), "api", "fetch");
    });

    const externalNodes = [
      ["Cloudflare Edge", "https://cloudflare.com/network", "cdn", "Cloudflare", ["cloudflare", "cdn", "edge"]],
      ["Google Tag Manager", "https://www.googletagmanager.com/gtm.js", "analytics", "Google", ["tracking", "analytics", "tag"]],
      ["Google Analytics", "https://www.google-analytics.com/g/collect", "tracking", "Google", ["tracking", "analytics"]],
      ["Stripe Checkout", "https://checkout.stripe.com/c/pay", "service", "Stripe", ["stripe", "checkout", "payment"]],
      ["jsDelivr CDN", "https://cdn.jsdelivr.net/npm", "cdn", "CDN", ["cdn", "package", "script"]],
      ["GitHub", "https://github.com", "external", "GitHub", ["github", "repo"]],
      ["LinkedIn", "https://linkedin.com/company", "social", "Social", ["social", "linkedin"]],
      ["X Social", "https://x.com/share", "social", "Social", ["social", "share"]]
    ].map(([title, url, type, cluster, keywords], index) => {
      const parent = index < 4 ? root : choice(pages);
      const node = addNode(type, url, title, cluster, parent.id, {
        contentType: type === "cdn" ? "application/javascript" : "text/html",
        keywords
      });
      addEdge(parent, node, type === "cdn" ? "asset" : "external", cluster.toLowerCase());
      return node;
    });

    const hiddenNodes = [
      ["Robots", "/robots.txt", ["robots", "crawler", "security"]],
      ["Sitemap", "/sitemap.xml", ["sitemap", "xml", "pages"]],
      ["OpenAPI Spec", "/openapi.json", ["openapi", "api", "json"]],
      ["GraphQL Schema", "/graphql/schema.json", ["graphql", "schema", "api"]],
      ["Security TXT", "/.well-known/security.txt", ["security", "contact"]],
      ["Web Manifest", "/manifest.webmanifest", ["manifest", "pwa"]],
      ["Service Worker", "/service-worker.js", ["worker", "offline", "script"]],
      ["RSS Feed", "/rss.xml", ["rss", "feed"]],
      ["Public Assets", "/public/assets.json", ["assets", "json"]]
    ].map(([title, path, keywords], index) => {
      const type = path.endsWith(".js") ? "js" : "hidden";
      const node = addNode(type, path, title, "Hidden Discovery", root.id, {
        contentType: path.endsWith(".xml") ? "application/xml" : path.endsWith(".txt") ? "text/plain" : "application/json",
        keywords
      });
      addEdge(root, node, index % 3 === 0 ? "internal" : "api", "probe");
      return node;
    });

    const errorNodes = [
      ["Admin Probe", "/admin", 403, ["security", "admin", "risk"]],
      ["Legacy CMS Login", "/wp-login.php", 404, ["cms", "wordpress", "risk"]],
      ["Old Product Redirect", "/old-products", 301, ["redirect", "product", "migration"]],
      ["Missing Source Map", "/assets/app.js.map", 404, ["sourcemap", "error", "script"]]
    ].map(([title, path, status, keywords]) => {
      const type = status === 301 ? "redirect" : "error";
      const node = addNode(type, path, title, "Risk Surface", root.id, {
        status,
        contentType: status === 301 ? "text/html" : "application/problem+json",
        keywords
      });
      addEdge(root, node, status === 301 ? "redirect" : "error", String(status));
      return node;
    });

    hiddenNodes.slice(0, 4).forEach((hidden) => {
      if (hidden.title.includes("OpenAPI") || hidden.title.includes("GraphQL")) {
        addEdge(hidden, choice(apiNodes), "api", "documents");
      } else if (hidden.title.includes("Sitemap")) {
        pages.forEach((page) => {
          if (state.rand() > 0.56) addEdge(hidden, page, "internal", "listed");
        });
      }
    });

    externalNodes.forEach((external) => {
      if (external.cluster === "Google") {
        addEdge(choice(pages), external, "external", "beacon");
      }
      if (external.cluster === "Stripe") {
        const checkout = apiNodes.find((node) => node.title.includes("Checkout"));
        if (checkout) addEdge(checkout, external, "external", "payment");
      }
    });

    errorNodes.forEach((node) => {
      if (node.type === "redirect") addEdge(node, pages.find((page) => page.path === "/products") || root, "redirect", "target");
    });

    state.metadata = buildMetadata(host, state.nodes, state.edges);
    applyLayoutTargets(true);
    renderStaticUi();
    updateInspector();
  }

  function closeLiveScan() {
    window.clearTimeout(state.liveFallbackTimer);
    state.liveFallbackTimer = 0;
    if (state.liveSource) {
      state.liveSource.close();
      state.liveSource = null;
    }
  }

  function defaultMetadata(host, phase = "Starting live crawl") {
    return {
      hosting: "Checking",
      framework: "Checking",
      cms: "Checking",
      analytics: "Checking",
      robots: "Not checked yet",
      sitemap: "Not checked yet",
      securityHeaders: "Checking",
      performanceScore: 0,
      riskScore: 0,
      stack: ["Live crawler"],
      summary: `${phase}: waiting for ${host} to stream real pages, requests, headers, assets, APIs, and redirects.`
    };
  }

  function resetGraphState(rawUrl, source = "live") {
    const parsed = normalizeUrl(rawUrl);
    const host = parsed.hostname.replace(/^www\./, "");
    window.clearTimeout(state.scan.handle);
    state.scan.version += 1;
    state.scan.index = 0;
    state.scan.active = source === "live";
    state.scan.paused = false;
    state.scan.reverse = false;
    state.host = host;
    state.origin = parsed.origin;
    state.seed = hashString(host + parsed.pathname + source);
    state.rand = mulberry32(state.seed);
    state.nodes = [];
    state.edges = [];
    state.nodeById = new Map();
    state.edgeById = new Map();
    state.timeline = [];
    state.selectedId = null;
    state.hoverId = null;
    state.contextNodeId = null;
    state.searchIds.clear();
    state.collapsedClusters.clear();
    state.displayedStats = {};
    state.currentStats = {};
    state.lastClusterSignature = "";
    window.clearTimeout(state.layoutFrame);
    window.clearTimeout(state.clusterFrame);
    window.clearTimeout(state.statsFrame);
    state.layoutFrame = 0;
    state.clusterFrame = 0;
    state.statsFrame = 0;
    state.metadata = defaultMetadata(host);
    state.autoFollow = true;
    renderStaticUi();
    updateInspector();
    return parsed;
  }

  function startLiveScan(rawUrl) {
    closeLiveScan();
    let parsed;
    try {
      parsed = resetGraphState(rawUrl, "live");
    } catch {
      showToast("Enter a valid website URL.");
      return;
    }

    if (!("EventSource" in window) || window.location.protocol === "file:") {
      startDemoScan(rawUrl, "Live crawler requires the Python server. Showing demo graph.");
      return;
    }

    const scanUrl = `/api/scan?url=${encodeURIComponent(parsed.href)}&max_pages=30&max_resources=240`;
    const source = new EventSource(scanUrl);
    state.liveSource = source;
    showToast(`Live scanning ${state.host}`);

    state.liveFallbackTimer = window.setTimeout(() => {
      if (state.liveSource === source && state.nodes.length === 0) {
        startDemoScan(rawUrl, "Crawler did not respond. Showing demo graph.");
      }
    }, 4500);

    source.onmessage = (event) => {
      window.clearTimeout(state.liveFallbackTimer);
      state.liveFallbackTimer = 0;
      try {
        handleCrawlerEvent(JSON.parse(event.data));
      } catch {
        showToast("Crawler sent an unreadable event.");
      }
    };

    source.onerror = () => {
      if (state.liveSource !== source) return;
      source.close();
      state.liveSource = null;
      if (state.nodes.length === 0) {
        startDemoScan(rawUrl, "Crawler unavailable. Showing demo graph.");
      } else {
        state.scan.active = false;
        showToast("Crawler stream closed.");
      }
    };
  }

  function startDemoScan(rawUrl, message) {
    closeLiveScan();
    try {
      buildGraph(rawUrl);
      resetDiscovery("forward");
      showToast(message || `Demo scanning ${state.host}`);
    } catch {
      showToast("Enter a valid website URL.");
    }
  }

  function handleCrawlerEvent(payload) {
    if (!payload || !payload.kind) return;
    if (payload.kind === "meta") {
      state.metadata = { ...defaultMetadata(state.host, "Crawling"), ...payload.metadata };
      renderMetadata();
      return;
    }
    if (payload.kind === "node") {
      const node = upsertCrawlerNode(payload.node);
      scheduleLayoutUpdate();
      scheduleClusterRender();
      revealNode(node, payload.verb || "Discovered");
      if (state.selectedId === node.id) updateInspector();
      return;
    }
    if (payload.kind === "edge") {
      const edge = upsertCrawlerEdge(payload.edge);
      if (edge) {
        const source = state.nodeById.get(edge.source);
        const target = state.nodeById.get(edge.target);
        if (source?.discovered && target?.discovered) {
          edge.discovered = true;
          edge.birth = performance.now();
          scheduleStatsUpdate();
        }
      }
      return;
    }
    if (payload.kind === "error") {
      showToast(payload.message || "Crawler failed.");
      return;
    }
    if (payload.kind === "done") {
      closeLiveScan();
      state.scan.active = false;
      fitGraph();
      showToast(`Crawl complete: ${payload.summary?.nodes || state.nodes.length} nodes, ${payload.summary?.edges || state.edges.length} edges`);
    }
  }

  function upsertCrawlerNode(raw) {
    const existing = state.nodeById.get(raw.id);
    const parent = raw.parentId ? state.nodeById.get(raw.parentId) : null;
    const angle = state.rand() * Math.PI * 2;
    const distance = parent ? 72 + state.rand() * 62 : 0;
    const type = raw.type || "page";
    const base = existing || {
      id: raw.id,
      hidden: false,
      pinned: false,
      discovered: false,
      birth: 0,
      visits: 0,
      alpha: 0,
      x: parent ? parent.x + Math.cos(angle) * distance : 0,
      y: parent ? parent.y + Math.sin(angle) * distance : 0,
      z: parent ? (state.rand() - 0.5) * 140 : 0,
      vx: 0,
      vy: 0,
      vz: 0,
      tx: 0,
      ty: 0,
      tz: 0,
      order: state.nodes.length
    };
    const node = {
      ...base,
      ...raw,
      type,
      layer: layerForType(type),
      cluster: raw.cluster || "Discovered",
      parentId: raw.parentId || null,
      depth: raw.id === "root" ? 0 : parent ? parent.depth + 1 : existing?.depth ?? 1,
      status: raw.status ?? 0,
      contentType: raw.contentType || contentTypeFor(type),
      headers: raw.headers || {},
      keywords: raw.keywords || [],
      radius: radiusFor(type)
    };
    if (existing) {
      Object.assign(existing, node);
      return existing;
    }
    state.nodes.push(node);
    state.nodeById.set(node.id, node);
    return node;
  }

  function upsertCrawlerEdge(raw) {
    if (!raw?.id) return null;
    if (state.edgeById.has(raw.id)) {
      return state.edgeById.get(raw.id);
    }
    const edge = {
      id: raw.id,
      source: raw.source,
      target: raw.target,
      type: raw.type || "internal",
      label: raw.label || "",
      discovered: false,
      birth: 0,
      seed: state.rand()
    };
    state.edges.push(edge);
    state.edgeById.set(edge.id, edge);
    return edge;
  }

  function contentTypeFor(type) {
    const map = {
      page: "text/html; charset=utf-8",
      api: "application/json",
      image: "image/webp",
      video: "video/mp4",
      pdf: "application/pdf",
      css: "text/css",
      js: "application/javascript",
      font: "font/woff2",
      cdn: "application/javascript",
      external: "text/html",
      service: "text/html",
      analytics: "application/javascript",
      social: "text/html",
      subdomain: "text/html",
      error: "application/problem+json",
      redirect: "text/html",
      hidden: "application/json",
      tracking: "image/gif"
    };
    return map[type] || "application/octet-stream";
  }

  function radiusFor(type) {
    const map = {
      page: 17,
      api: 15,
      image: 13,
      video: 14,
      pdf: 13,
      css: 12,
      js: 13,
      font: 11,
      subdomain: 15,
      error: 14,
      redirect: 13,
      hidden: 13,
      cdn: 14,
      service: 14,
      analytics: 13,
      tracking: 12
    };
    return map[type] || 12;
  }

  function keywordsForPage(title, path) {
    const words = [title.toLowerCase(), path.replace(/[^a-z]/gi, " ").trim()];
    if (/product|pricing|checkout/i.test(`${title} ${path}`)) words.push("product", "commerce");
    if (/login|dashboard/i.test(`${title} ${path}`)) words.push("auth", "session");
    if (/blog|docs|developer/i.test(`${title} ${path}`)) words.push("content", "pagination");
    return { keywords: words };
  }

  function headersFor(type, host) {
    const base = {
      "server": choice(["cloudflare", "nginx", "Vercel", "Fly.io", "Fastly"]),
      "cache-control": choice(["public, max-age=31536000", "no-store", "s-maxage=3600, stale-while-revalidate=86400"]),
      "x-content-type-options": "nosniff",
      "strict-transport-security": "max-age=63072000; includeSubDomains; preload"
    };
    if (type === "api") {
      base["access-control-allow-origin"] = `https://${host}`;
      base["x-request-id"] = Math.random().toString(36).slice(2, 10);
    }
    if (type === "redirect") base.location = `https://${host}/products`;
    if (type === "error") base["retry-after"] = "120";
    return base;
  }

  function buildMetadata(host, nodes, edges) {
    const seed = state.seed;
    const hosting = choice(["Vercel Edge Network", "Cloudflare Workers", "AWS CloudFront", "Fastly Compute", "Fly.io"]);
    const framework = choice(["Next.js", "Remix", "Astro", "SvelteKit", "Nuxt", "Custom React"]);
    const cms = choice(["Sanity", "Contentful", "WordPress headless", "No CMS detected", "Builder.io"]);
    const analytics = nodes.some((node) => node.type === "analytics" || node.type === "tracking") ? "Google Analytics, Tag Manager" : "Not detected";
    const risk = clamp(8 + (nodes.filter((node) => node.type === "error").length * 9) + (seed % 14), 1, 99);
    const perf = clamp(96 - Math.floor(risk / 3) - (edges.length % 8), 48, 99);
    return {
      hosting,
      framework,
      cms,
      analytics,
      robots: nodes.some((node) => node.path === "/robots.txt") ? "Found" : "Missing",
      sitemap: nodes.some((node) => node.path === "/sitemap.xml") ? "Found" : "Missing",
      securityHeaders: "HSTS, nosniff, CSP candidate",
      performanceScore: perf,
      riskScore: risk,
      stack: [hosting, framework, cms, analytics, "HTTP/3", "TLS 1.3"],
      summary: `${host} resolves into ${nodes.length} mapped resources across ${new Set(nodes.map((node) => node.cluster)).size} clusters, with ${edges.length} observed relationships, inferred APIs, hidden endpoints, and third-party services.`
    };
  }

  function applyLayoutTargets(resetPositions = false) {
    const clusters = [...new Set(state.nodes.map((node) => node.cluster))];
    const clusterIndex = new Map(clusters.map((cluster, index) => [cluster, index]));
    const byDepth = new Map();
    const typeBuckets = new Map();
    state.nodes.forEach((node) => {
      if (!byDepth.has(node.depth)) byDepth.set(node.depth, []);
      byDepth.get(node.depth).push(node);
      if (!typeBuckets.has(node.type)) typeBuckets.set(node.type, []);
      typeBuckets.get(node.type).push(node);
    });

    state.nodes.forEach((node, index) => {
      const clusterSlot = clusterIndex.get(node.cluster) || 0;
      const angle = (clusterSlot / Math.max(1, clusters.length)) * Math.PI * 2 + (state.rand() - 0.5) * 0.25;
      const depth = node.depth + 1;
      let tx = Math.cos(angle) * (130 + depth * 82) + (state.rand() - 0.5) * 120;
      let ty = Math.sin(angle) * (120 + depth * 72) + (state.rand() - 0.5) * 120;
      let tz = (state.rand() - 0.5) * 240;

      if (state.layout === "radial") {
        const layerOrder = layerDefs.findIndex((layer) => layer.id === node.layer);
        const ring = 70 + (Math.max(0, layerOrder) + 1) * 42;
        const bucket = typeBuckets.get(node.type) || [];
        const slot = bucket.indexOf(node);
        const theta = (slot / Math.max(1, bucket.length)) * Math.PI * 2 + layerOrder * 0.32;
        tx = Math.cos(theta) * ring;
        ty = Math.sin(theta) * ring;
        tz = 0;
      }

      if (state.layout === "tree") {
        const level = byDepth.get(node.depth) || [];
        const slot = level.indexOf(node);
        const spread = Math.max(1, level.length - 1);
        tx = (slot / spread - 0.5) * Math.max(440, level.length * 84);
        ty = node.depth * 155 - 270;
        tz = 0;
      }

      if (state.layout === "galaxy") {
        const turn = index * 0.52;
        const arm = index % 4;
        const radius = 74 + index * 8.6;
        tx = Math.cos(turn + arm * 1.2) * radius;
        ty = Math.sin(turn + arm * 1.2) * radius * 0.58;
        tz = (index % 9) * 32 - 144;
      }

      if (state.layout === "sphere") {
        const n = state.nodes.length;
        const phi = Math.acos(1 - (2 * (index + 0.5)) / n);
        const theta = Math.PI * (1 + Math.sqrt(5)) * index;
        const radius = 430;
        tx = Math.cos(theta) * Math.sin(phi) * radius;
        ty = Math.sin(theta) * Math.sin(phi) * radius;
        tz = Math.cos(phi) * radius;
      }

      if (node.id === "root") {
        tx = 0;
        ty = 0;
        tz = 0;
      }

      node.tx = tx;
      node.ty = ty;
      node.tz = tz;
      if (resetPositions) {
        node.x = lerp(node.x, tx, 0.65);
        node.y = lerp(node.y, ty, 0.65);
        node.z = lerp(node.z, tz, 0.65);
      }
    });
  }

  function renderStaticUi() {
    renderMetadata();

    els.statsGrid.innerHTML = statDefs
      .map((stat) => `<div class="stat" data-stat="${stat.key}"><strong>0</strong><span>${esc(stat.label)}</span></div>`)
      .join("");
    state.statEls = new Map(statDefs.map((stat) => [stat.key, els.statsGrid.querySelector(`[data-stat="${stat.key}"] strong`)]));

    els.filters.innerHTML = layerDefs
      .map((layer) => {
        const color = typeColor[layer.types[0]] || "#f4f7ff";
        return `<label class="filter-pill"><span class="filter-dot" style="color:${color};background:${color}"></span><input type="checkbox" data-layer="${esc(layer.id)}" checked />${esc(layer.name)}</label>`;
      })
      .join("");

    renderClusterList();
    els.timelineList.innerHTML = "";
    updateStats();
  }

  function renderMetadata() {
    const metadata = state.metadata || defaultMetadata(state.host);
    els.siteTitle.textContent = state.host;
    els.siteSummary.textContent = metadata.summary;
    els.performanceScore.textContent = metadata.performanceScore;
    els.riskScore.textContent = metadata.riskScore;
    els.stackChips.innerHTML = (metadata.stack || ["Live crawler"]).map((item) => `<span class="chip">${esc(item)}</span>`).join("");
  }

  function scheduleLayoutUpdate() {
    if (state.layoutFrame) return;
    state.layoutFrame = window.setTimeout(() => {
      state.layoutFrame = 0;
      applyLayoutTargets();
    }, state.nodes.length > 220 ? 160 : 70);
  }

  function scheduleClusterRender() {
    if (state.clusterFrame) return;
    state.clusterFrame = window.setTimeout(() => {
      state.clusterFrame = 0;
      renderClusterList();
    }, 180);
  }

  function scheduleStatsUpdate() {
    if (state.statsFrame) return;
    state.statsFrame = window.setTimeout(() => {
      state.statsFrame = 0;
      updateStats();
    }, 80);
  }

  function renderClusterList() {
    const clusterCounts = new Map();
    state.nodes.forEach((node) => clusterCounts.set(node.cluster, (clusterCounts.get(node.cluster) || 0) + 1));
    const entries = [...clusterCounts.entries()];
    const signature = entries.map(([cluster, count]) => `${cluster}:${count}`).join("|");
    if (signature === state.lastClusterSignature) return;
    state.lastClusterSignature = signature;
    els.clusterList.innerHTML = entries
      .map(([cluster, count], index) => {
        const color = Object.values(typeColor)[index % Object.values(typeColor).length];
        const collapsed = state.collapsedClusters.has(cluster) ? " is-collapsed" : "";
        return `<button class="cluster-chip${collapsed}" data-cluster="${esc(cluster)}"><span class="cluster-dot" style="color:${color};background:${color}"></span>${esc(cluster)} <span>${count}</span></button>`;
      })
      .join("");
  }

  function resetDiscovery(mode = "forward") {
    window.clearTimeout(state.scan.handle);
    state.scan.version += 1;
    state.scan.index = mode === "reverse" ? state.nodes.length - 1 : 0;
    state.scan.active = true;
    state.scan.reverse = mode === "reverse";
    state.scan.paused = false;
    state.timeline = [];
    els.timelineList.innerHTML = "";
    state.nodes.forEach((node) => {
      node.discovered = mode === "reverse";
      node.birth = mode === "reverse" ? performance.now() - 1200 : 0;
      node.alpha = mode === "reverse" ? 1 : 0;
      node.visits = mode === "reverse" ? 1 : 0;
      node.hidden = false;
    });
    state.edges.forEach((edge) => {
      edge.discovered = mode === "reverse";
      edge.birth = mode === "reverse" ? performance.now() - 1200 : 0;
    });
    state.autoFollow = true;
    updateStats();
    scheduleDiscovery(state.scan.version);
  }

  function scheduleDiscovery(version) {
    if (version !== state.scan.version) return;
    const delay = Math.max(20, 126 / state.scan.speed);
    state.scan.handle = window.setTimeout(() => discoveryStep(version), delay);
  }

  function discoveryStep(version) {
    if (version !== state.scan.version || !state.scan.active) return;
    if (state.scan.paused) {
      scheduleDiscovery(version);
      return;
    }

    if (state.scan.reverse) {
      const node = state.nodes[state.scan.index];
      if (!node) {
        state.scan.active = false;
        return;
      }
      hideNodeForReplay(node);
      state.scan.index -= 1;
      scheduleDiscovery(version);
      return;
    }

    const node = state.nodes[state.scan.index];
    if (!node) {
      state.scan.active = false;
      fitGraph();
      return;
    }
    revealNode(node, "Discovered");
    state.scan.index += 1;
    scheduleDiscovery(version);
  }

  function revealNode(node, verb = "Discovered") {
    if (!node) return;
    const now = performance.now();
    node.discovered = true;
    node.hidden = false;
    node.birth = now;
    node.visits += 1;
    node.alpha = Math.max(node.alpha, 0.08);

    state.edges.forEach((edge) => {
      const source = state.nodeById.get(edge.source);
      const target = state.nodeById.get(edge.target);
      if (source?.discovered && target?.discovered && !edge.discovered) {
        edge.discovered = true;
        edge.birth = now;
      }
    });

    const event = {
      id: `${node.id}-${now}`,
      type: node.type,
      title: node.title,
      url: node.url,
      at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      verb
    };
    state.timeline.push(event);
    appendTimeline(event);
    scheduleStatsUpdate();

    if (state.autoFollow && (node.order < 8 || node.order % 4 === 0)) {
      focusNode(node, node.order < 3 ? 1.05 : 0.82, false);
    }
  }

  function hideNodeForReplay(node) {
    if (!node || node.id === "root") return;
    node.discovered = false;
    node.alpha = 0;
    state.edges.forEach((edge) => {
      if (edge.source === node.id || edge.target === node.id) edge.discovered = false;
    });
    const event = {
      id: `reverse-${node.id}-${performance.now()}`,
      type: node.type,
      title: node.title,
      url: node.url,
      at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      verb: "Rewound"
    };
    state.timeline.push(event);
    appendTimeline(event);
    updateStats();
  }

  function appendTimeline(event) {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${esc(event.title)}</strong>${esc(event.verb)} ${esc(typeLabel[event.type] || event.type)} at ${esc(event.at)}`;
    li.title = event.url;
    li.addEventListener("click", () => {
      const node = state.nodes.find((candidate) => candidate.url === event.url);
      if (node) selectNode(node, true);
    });
    els.timelineList.prepend(li);
    while (els.timelineList.children.length > 8) {
      els.timelineList.lastElementChild.remove();
    }
  }

  function updateStats() {
    const discoveredNodes = state.nodes.filter((node) => node.discovered);
    statDefs.forEach((stat) => {
      if (stat.edge) {
        state.currentStats[stat.key] = state.edges.filter((edge) => edge.discovered).length;
      } else {
        state.currentStats[stat.key] = discoveredNodes.filter((node) => stat.types.includes(node.type)).length;
      }
      if (state.displayedStats[stat.key] == null) state.displayedStats[stat.key] = 0;
    });
  }

  function visibleNode(node) {
    if (!node || !node.discovered || node.hidden) return false;
    if (node.id === "root") return true;
    if (!state.activeFilters.has(node.layer)) return false;
    if (state.collapsedClusters.has(node.cluster)) return false;
    return true;
  }

  function visibleEdge(edge) {
    if (!edge.discovered) return false;
    return visibleNode(state.nodeById.get(edge.source)) && visibleNode(state.nodeById.get(edge.target));
  }

  function highlightActive() {
    return state.searchIds.size > 0;
  }

  function isHighlighted(node) {
    if (!highlightActive()) return true;
    return state.searchIds.has(node.id);
  }

  function updatePhysics(dt) {
    const nodes = state.nodes.filter(visibleNode);
    const is3d = state.layout === "galaxy" || state.layout === "sphere";
    const highVolume = nodes.length > 240;
    const densityScale = Math.max(1, nodes.length / 90);
    const repel = (is3d ? 7200 : 9600) / densityScale;
    const maxPairForce = 0.28 * dt;
    const maxSpringForce = 1.1 * dt;
    const maxVelocity = nodes.length > 180 ? 18 : 42;

    nodes.forEach((node) => {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y) || Math.abs(node.x) > 5000 || Math.abs(node.y) > 5000) {
        node.x = (Number.isFinite(node.tx) ? node.tx : 0) + (state.rand() - 0.5) * 90;
        node.y = (Number.isFinite(node.ty) ? node.ty : 0) + (state.rand() - 0.5) * 90;
        node.z = Number.isFinite(node.tz) ? node.tz : 0;
        node.vx = 0;
        node.vy = 0;
        node.vz = 0;
      }
    });

    if (!highVolume || state.frame % 3 === 0) {
      const neighborChecks = nodes.length > 220 ? 4 : nodes.length > 120 ? 8 : nodes.length - 1;
      const neighborStride = nodes.length > 220 ? Math.max(1, Math.floor(nodes.length / 120)) : 1;
      for (let i = 0; i < nodes.length; i += 1) {
        const checks = Math.min(neighborChecks, nodes.length - 1);
        for (let offset = 1; offset <= checks; offset += 1) {
          const j = (i + offset * neighborStride) % nodes.length;
          if (j <= i) continue;
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dz = is3d ? b.z - a.z : 0;
          let distSq = dx * dx + dy * dy + dz * dz;
          if (distSq < 0.01) {
            dx = (state.rand() - 0.5) * 0.1;
            dy = (state.rand() - 0.5) * 0.1;
            distSq = 0.01;
          }
          const dist = Math.sqrt(distSq);
          const force = Math.min(maxPairForce, repel / Math.max(900, distSq));
          const fx = (dx / dist) * force * dt;
          const fy = (dy / dist) * force * dt;
          const fz = (dz / dist) * force * dt;
          if (!a.pinned && state.dragNode !== a) {
            a.vx -= fx;
            a.vy -= fy;
            a.vz -= fz;
          }
          if (!b.pinned && state.dragNode !== b) {
            b.vx += fx;
            b.vy += fy;
            b.vz += fz;
          }
        }
      }
    }

    state.edges.forEach((edge) => {
      if (!visibleEdge(edge)) return;
      const a = state.nodeById.get(edge.source);
      const b = state.nodeById.get(edge.target);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = is3d ? b.z - a.z : 0;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
      const target = edge.type === "asset" ? 120 : edge.type === "external" ? 190 : 150;
      const force = clamp((dist - target) * 0.0035 * dt, -maxSpringForce, maxSpringForce);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const fz = (dz / dist) * force;
      if (!a.pinned && state.dragNode !== a) {
        a.vx += fx;
        a.vy += fy;
        a.vz += fz;
      }
      if (!b.pinned && state.dragNode !== b) {
        b.vx -= fx;
        b.vy -= fy;
        b.vz -= fz;
      }
    });

    nodes.forEach((node) => {
      if (node.pinned || state.dragNode === node) return;
      const layoutStrength = state.layout === "organic" ? 0.002 : 0.009;
      node.vx += clamp((node.tx - node.x) * layoutStrength * dt, -maxSpringForce, maxSpringForce);
      node.vy += clamp((node.ty - node.y) * layoutStrength * dt, -maxSpringForce, maxSpringForce);
      node.vz += clamp((node.tz - node.z) * layoutStrength * dt, -maxSpringForce, maxSpringForce);
    });

    nodes.forEach((node) => {
      if (state.dragNode === node) return;
      if (!node.pinned) {
        node.vx = clamp(node.vx, -maxVelocity, maxVelocity);
        node.vy = clamp(node.vy, -maxVelocity, maxVelocity);
        node.vz = clamp(node.vz, -maxVelocity, maxVelocity);
        node.x += node.vx * dt;
        node.y += node.vy * dt;
        node.z += node.vz * dt;
      }
      node.vx *= 0.88;
      node.vy *= 0.88;
      node.vz *= 0.88;
      const desiredAlpha = visibleNode(node) ? 1 : 0;
      node.alpha += (desiredAlpha - node.alpha) * 0.08;
    });
  }

  function updateCamera() {
    const camera = state.camera;
    camera.x += (camera.targetX - camera.x) * 0.095;
    camera.y += (camera.targetY - camera.y) * 0.095;
    camera.zoom += (camera.targetZoom - camera.zoom) * 0.11;
  }

  function project(node) {
    let x = node.x;
    let y = node.y;
    let z = node.z || 0;
    let scale = 1;
    const is3d = state.layout === "galaxy" || state.layout === "sphere";

    if (is3d) {
      const yaw = state.time * 0.000055;
      const pitch = state.layout === "sphere" ? 0.42 : 0.26;
      const cosY = Math.cos(yaw);
      const sinY = Math.sin(yaw);
      const rx = x * cosY - z * sinY;
      const rz = x * sinY + z * cosY;
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      const ry = y * cosP - rz * sinP;
      const rz2 = y * sinP + rz * cosP;
      x = rx;
      y = ry;
      z = rz2;
      scale = 760 / (760 + z);
      scale = clamp(scale, 0.36, 1.8);
    }

    return {
      x,
      y,
      z,
      scale,
      sx: (x - state.camera.x) * state.camera.zoom * scale + state.width / 2,
      sy: (y - state.camera.y) * state.camera.zoom * scale + state.height / 2
    };
  }

  function screenToWorld(x, y) {
    return {
      x: (x - state.width / 2) / state.camera.zoom + state.camera.x,
      y: (y - state.height / 2) / state.camera.zoom + state.camera.y
    };
  }

  function draw() {
    ctx.clearRect(0, 0, state.width, state.height);
    prepareRenderCache();
    drawBackdrop();
    drawClusters();
    drawEdges();
    drawNodes();
    if (state.nodes.length < 240 || Math.floor(state.time / 140) % 2 === 0) {
      drawMiniMap();
    }
    if (state.nodes.length < 240 || Math.floor(state.time / 100) % 2 === 0) {
      drawStatsNumbers();
    }
  }

  function prepareRenderCache() {
    const visibleNodes = [];
    const nodeIds = new Set();
    const points = new Map();
    const is3d = state.layout === "galaxy" || state.layout === "sphere";
    state.nodes.forEach((node) => {
      if (!visibleNode(node)) return;
      const point = project(node);
      visibleNodes.push({ node, point });
      nodeIds.add(node.id);
      points.set(node.id, point);
    });
    if (is3d) visibleNodes.sort((a, b) => a.point.z - b.point.z);
    const visibleEdges = state.edges.filter((edge) => edge.discovered && nodeIds.has(edge.source) && nodeIds.has(edge.target));
    state.render = {
      nodes: visibleNodes,
      nodeIds,
      points,
      edges: visibleEdges,
      highVolume: visibleNodes.length > 240 || visibleEdges.length > 360
    };
  }

  function drawBackdrop() {
    if (state.layout !== "galaxy" && state.layout !== "sphere") return;
    ctx.save();
    const count = 120;
    for (let i = 0; i < count; i += 1) {
      const seed = hashString(`${state.seed}-${i}`);
      const rand = mulberry32(seed);
      const x = (rand() * state.width + state.time * (0.002 + rand() * 0.006)) % state.width;
      const y = rand() * state.height;
      const r = 0.5 + rand() * 1.5;
      ctx.globalAlpha = 0.22 + rand() * 0.36;
      ctx.fillStyle = rand() > 0.7 ? "#56f0a4" : "#f4f7ff";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawClusters() {
    const groups = new Map();
    const visible = state.render.nodes;
    if (visible.length > 260) return;
    visible.forEach(({ node }) => {
      if (!groups.has(node.cluster)) groups.set(node.cluster, []);
      groups.get(node.cluster).push(node);
    });

    ctx.save();
    [...groups.entries()].forEach(([cluster, nodes], index) => {
      if (nodes.length < 3) return;
      const points = nodes.map(project);
      const cx = points.reduce((sum, point) => sum + point.sx, 0) / points.length;
      const cy = points.reduce((sum, point) => sum + point.sy, 0) / points.length;
      const radius = Math.max(86, Math.max(...points.map((point) => Math.hypot(point.sx - cx, point.sy - cy))) + 46);
      const color = Object.values(typeColor)[index % Object.values(typeColor).length];
      const gradient = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius);
      gradient.addColorStop(0, hexToRgba(color, 0.08));
      gradient.addColorStop(0.72, hexToRgba(color, 0.025));
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius * 1.08, radius * 0.76, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.2;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 0.44;
      ctx.fillStyle = "#f6f7fb";
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      ctx.fillText(cluster, cx - radius * 0.55, cy - radius * 0.42);
      ctx.globalAlpha = 1;
    });
    ctx.restore();
  }

  function drawEdges() {
    const edges = state.render.edges;
    const highVolume = state.render.highVolume;
    ctx.save();
    ctx.lineCap = "round";
    edges.forEach((edge) => {
      const source = state.nodeById.get(edge.source);
      const target = state.nodeById.get(edge.target);
      const a = state.render.points.get(edge.source);
      const b = state.render.points.get(edge.target);
      if (!source || !target || !a || !b) return;
      const color = edgeColor[edge.type] || "#f4f7ff";
      const age = easeOut((state.time - edge.birth) / 700);
      const highlighted = isHighlighted(source) || isHighlighted(target);
      const alpha = age * (highlightActive() && !highlighted ? 0.12 : 0.62);
      if (alpha <= 0.01) return;

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = highVolume ? 0.85 : edge.type === "error" ? 1.6 : 1.15;
      ctx.shadowColor = color;
      ctx.shadowBlur = highVolume ? 0 : 8;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      if (highVolume) {
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
        return;
      }
      const mx = (a.sx + b.sx) / 2;
      const my = (a.sy + b.sy) / 2;
      const bow = edge.type === "external" ? 26 : 12;
      const nx = b.sy - a.sy;
      const ny = a.sx - b.sx;
      const len = Math.max(1, Math.hypot(nx, ny));
      ctx.quadraticCurveTo(mx + (nx / len) * bow, my + (ny / len) * bow, b.sx, b.sy);
      ctx.stroke();

      ctx.shadowBlur = 16;
      for (let i = 0; i < 2; i += 1) {
        const t = (state.time * 0.00022 * state.scan.speed + edge.seed + i * 0.5) % 1;
        const x = quadratic(a.sx, mx + (nx / len) * bow, b.sx, t);
        const y = quadratic(a.sy, my + (ny / len) * bow, b.sy, t);
        ctx.globalAlpha = alpha * (0.46 + 0.5 * Math.sin(t * Math.PI));
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.restore();
  }

  function quadratic(a, b, c, t) {
    return (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;
  }

  function drawNodes() {
    const highVolume = state.render.highVolume;
    const nodes = state.render.nodes;
    ctx.save();
    nodes.forEach(({ node, point }) => {
      const age = easeOut((state.time - node.birth) / 620);
      const highlighted = isHighlighted(node);
      const hover = node.id === state.hoverId;
      const selected = node.id === state.selectedId;
      const color = typeColor[node.type] || "#f4f7ff";
      const pulse = Math.max(0, 1 - (state.time - node.birth) / 1800);
      const heat = node.visits > 0 ? Math.min(1, node.visits / 4) : 0;
      const fade = highlightActive() && !highlighted ? 0.18 : 1;
      const radius = node.radius * point.scale * state.camera.zoom * (hover ? 1.28 : selected ? 1.18 : 1) * (0.8 + age * 0.2);
      const r = highVolume && !hover && !selected ? clamp(radius * 0.72, 3, 13) : clamp(radius, 5, 31);
      node.alpha = Math.max(node.alpha, age);

      ctx.globalAlpha = fade * node.alpha;
      ctx.shadowColor = color;
      ctx.shadowBlur = highVolume && !selected && !hover ? 0 : (selected ? 34 : hover ? 30 : 16) + pulse * 18;

      if (highVolume && !selected && !hover) {
        ctx.fillStyle = color;
      } else {
        const gradient = ctx.createRadialGradient(point.sx - r * 0.35, point.sy - r * 0.35, 2, point.sx, point.sy, r * 1.75);
        gradient.addColorStop(0, "#ffffff");
        gradient.addColorStop(0.18, color);
        gradient.addColorStop(1, hexToRgba(color, 0.13 + heat * 0.18));
        ctx.fillStyle = gradient;
      }
      ctx.beginPath();
      ctx.arc(point.sx, point.sy, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.shadowBlur = 0;
      ctx.strokeStyle = selected ? "#ffffff" : hexToRgba("#ffffff", hover ? 0.62 : 0.2);
      ctx.lineWidth = selected ? 1.6 : 1;
      ctx.stroke();

      if (pulse > 0.01 || selected) {
        ctx.globalAlpha = fade * (pulse * 0.36 + (selected ? 0.28 : 0));
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(point.sx, point.sy, r + 9 + pulse * 20, 0, Math.PI * 2);
        ctx.stroke();
      }

      if (!highVolume || hover || selected || (highlightActive() && highlighted)) {
        ctx.globalAlpha = fade * clamp(node.alpha + 0.1, 0, 1);
        ctx.fillStyle = "#07080a";
        ctx.font = `800 ${clamp(r * 0.45, 7, 10)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(typeLabel[node.type] || node.type.slice(0, 3).toUpperCase(), point.sx, point.sy + 0.5);
      }

      if (hover || selected || (highlightActive() && highlighted)) {
        drawNodeLabel(node, point, color, fade);
      }
    });
    ctx.restore();
  }

  function drawNodeLabel(node, point, color, fade) {
    const text = node.title;
    ctx.save();
    ctx.font = "650 12px Inter, system-ui, sans-serif";
    const padding = 9;
    const w = Math.min(220, ctx.measureText(text).width + padding * 2);
    const h = 30;
    const x = clamp(point.sx + 14, 10, state.width - w - 10);
    const y = clamp(point.sy - h - 14, 10, state.height - h - 10);
    ctx.globalAlpha = fade * 0.94;
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    roundRect(ctx, x, y, w, h, 11);
    ctx.fillStyle = "rgba(8,9,11,0.84)";
    ctx.fill();
    ctx.strokeStyle = hexToRgba(color, 0.38);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#f6f7fb";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text.length > 28 ? `${text.slice(0, 27)}...` : text, x + padding, y + h / 2 + 0.5, w - padding * 2);
    ctx.restore();
  }

  function roundRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawMiniMap() {
    const rect = miniMap.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    miniCtx.clearRect(0, 0, w, h);
    const nodes = state.render.nodes.map((entry) => entry.node);
    if (nodes.length === 0) return;
    const bounds = graphBounds(nodes);
    const scale = Math.min((w - 24) / Math.max(1, bounds.width), (h - 24) / Math.max(1, bounds.height));
    const toMini = (node) => ({
      x: (node.x - bounds.minX) * scale + 12,
      y: (node.y - bounds.minY) * scale + 12
    });

    miniCtx.save();
    miniCtx.globalAlpha = 0.55;
    state.render.edges.forEach((edge) => {
      const a = toMini(state.nodeById.get(edge.source));
      const b = toMini(state.nodeById.get(edge.target));
      miniCtx.strokeStyle = edgeColor[edge.type] || "#f4f7ff";
      miniCtx.lineWidth = 0.8;
      miniCtx.beginPath();
      miniCtx.moveTo(a.x, a.y);
      miniCtx.lineTo(b.x, b.y);
      miniCtx.stroke();
    });
    nodes.forEach((node) => {
      const p = toMini(node);
      miniCtx.fillStyle = typeColor[node.type] || "#f4f7ff";
      miniCtx.beginPath();
      miniCtx.arc(p.x, p.y, node.id === "root" ? 3.5 : 2.2, 0, Math.PI * 2);
      miniCtx.fill();
    });

    const viewW = state.width / state.camera.zoom;
    const viewH = state.height / state.camera.zoom;
    const vx = (state.camera.x - viewW / 2 - bounds.minX) * scale + 12;
    const vy = (state.camera.y - viewH / 2 - bounds.minY) * scale + 12;
    miniCtx.globalAlpha = 0.8;
    miniCtx.strokeStyle = "#f6f7fb";
    miniCtx.lineWidth = 1;
    miniCtx.setLineDash([4, 4]);
    miniCtx.strokeRect(vx, vy, viewW * scale, viewH * scale);
    miniCtx.restore();
  }

  function drawStatsNumbers() {
    statDefs.forEach((stat) => {
      const target = state.currentStats[stat.key] || 0;
      const current = state.displayedStats[stat.key] || 0;
      state.displayedStats[stat.key] = lerp(current, target, 0.16);
      const el = state.statEls.get(stat.key);
      if (el) el.textContent = String(Math.round(state.displayedStats[stat.key]));
    });
  }

  function graphBounds(nodes = state.nodes.filter(visibleNode)) {
    if (!nodes.length) return { minX: -100, maxX: 100, minY: -100, maxY: 100, width: 200, height: 200 };
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    nodes.forEach((node) => {
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.y > maxY) maxY = node.y;
    });
    return {
      minX,
      maxX,
      minY,
      maxY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY)
    };
  }

  function fitGraph() {
    const nodes = state.nodes.filter(visibleNode);
    if (!nodes.length) return;
    const bounds = graphBounds(nodes);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const zoom = Math.min(1.25, Math.max(0.26, Math.min((state.width - 700) / Math.max(1, bounds.width), (state.height - 220) / Math.max(1, bounds.height))));
    state.camera.targetX = cx;
    state.camera.targetY = cy;
    state.camera.targetZoom = Number.isFinite(zoom) ? zoom : 0.72;
  }

  function focusNode(node, zoom = 1.08, userInitiated = true) {
    if (!node) return;
    state.camera.targetX = node.x;
    state.camera.targetY = node.y;
    state.camera.targetZoom = clamp(zoom, 0.28, 2.4);
    if (userInitiated) state.autoFollow = false;
  }

  function selectNode(node, shouldFocus = true) {
    if (!node) return;
    state.selectedId = node.id;
    revealNode(node, node.discovered ? "Selected" : "Expanded");
    if (shouldFocus) focusNode(node, Math.max(state.camera.targetZoom, 1.1));
    updateInspector();
  }

  function updateInspector() {
    const node = state.nodeById.get(state.selectedId);
    if (!node) {
      els.inspectorContent.className = "empty-state";
      els.inspectorContent.innerHTML = '<span class="empty-orbit"></span><strong>Select a node</strong><p>Click any graph object to inspect headers, relationships, previews, generated snippets, and endpoint details.</p>';
      return;
    }

    const incoming = state.edges.filter((edge) => edge.target === node.id);
    const outgoing = state.edges.filter((edge) => edge.source === node.id);
    const relations = [...incoming.map((edge) => state.nodeById.get(edge.source)), ...outgoing.map((edge) => state.nodeById.get(edge.target))]
      .filter(Boolean)
      .slice(0, 6);
    const color = typeColor[node.type] || "#f4f7ff";
    const headers = Object.entries(node.headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\n");

    els.inspectorContent.className = "";
    els.inspectorContent.innerHTML = `
      <div class="node-title">
        <span class="node-icon" style="background:${color};color:#050607">${esc(typeLabel[node.type] || node.type.slice(0, 3).toUpperCase())}</span>
        <div>
          <h2>${esc(node.title)}</h2>
          <p>${esc(node.url)}</p>
        </div>
      </div>
      <div class="meta-grid">
        <div class="meta"><span>Status</span><strong>${esc(node.status)}</strong></div>
        <div class="meta"><span>Type</span><strong>${esc(node.contentType)}</strong></div>
        <div class="meta"><span>Size</span><strong>${esc(node.size)} KB</strong></div>
        <div class="meta"><span>Load</span><strong>${esc(node.loadTime)} ms</strong></div>
        <div class="meta"><span>Incoming</span><strong>${incoming.length}</strong></div>
        <div class="meta"><span>Outgoing</span><strong>${outgoing.length}</strong></div>
      </div>
      <div class="preview">${previewFor(node, headers)}</div>
      <div class="relation-list">
        ${relations.map((relation) => `<button data-focus-node="${esc(relation.id)}">${esc(relation.title)} - ${esc(relation.type)}</button>`).join("")}
      </div>
    `;
  }

  function previewFor(node, headers) {
    if (node.type === "page") {
      return `
        <div class="preview-browser">
          <div class="preview-bar"><span></span><span></span><span></span></div>
          <div class="preview-hero"></div>
          <div class="preview-line"></div>
          <div class="preview-line short"></div>
        </div>
        <pre class="code-preview">${esc(headers)}</pre>
      `;
    }
    if (node.type === "api" || node.type === "hidden" || node.type === "error") {
      return `<pre class="code-preview">${esc(JSON.stringify(samplePayload(node), null, 2))}\n\n${esc(headers)}</pre>`;
    }
    if (["js", "css"].includes(node.type)) {
      return `<pre class="code-preview">${esc(sourcePreview(node))}\n\n${esc(headers)}</pre>`;
    }
    return `<pre class="code-preview">${esc(headers)}</pre>`;
  }

  function samplePayload(node) {
    if (node.type === "error") {
      return { status: node.status, error: node.title, trace: `req_${state.seed.toString(16)}`, retryable: node.status >= 500 };
    }
    if (node.title.toLowerCase().includes("product")) {
      return { data: [{ id: "prod_001", name: "Explorer", source: "/api/products" }], nextCursor: "eyJwYWdlIjoyfQ" };
    }
    if (node.title.toLowerCase().includes("auth") || node.url.includes("login")) {
      return { session: null, providers: ["oauth", "saml", "email"], csrf: "masked" };
    }
    if (node.title.toLowerCase().includes("graphql")) {
      return { data: { __schema: { queryType: { name: "Query" } } } };
    }
    return { ok: true, endpoint: node.path, cluster: node.cluster, observedAt: new Date().toISOString() };
  }

  function sourcePreview(node) {
    if (node.type === "css") {
      return `.webgraph-root {\n  color-scheme: dark;\n  background: #090909;\n  contain: layout paint;\n}`;
    }
    return `export async function request() {\n  const response = await fetch("${node.url}");\n  return response.json?.() ?? response.text();\n}`;
  }

  function findNodeAt(x, y) {
    let best = null;
    let bestDistance = Infinity;
    state.nodes.filter(visibleNode).forEach((node) => {
      const point = project(node);
      const radius = clamp(node.radius * point.scale * state.camera.zoom, 7, 32) + 8;
      const distance = Math.hypot(point.sx - x, point.sy - y);
      if (distance < radius && distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    });
    return best;
  }

  function updateHover(x, y) {
    const node = findNodeAt(x, y);
    state.hoverId = node ? node.id : null;
    canvas.style.cursor = state.dragNode || state.pan ? "grabbing" : node ? "pointer" : "grab";
  }

  function runSearch(query) {
    const q = query.trim().toLowerCase();
    state.searchIds.clear();
    if (!q) return;
    state.nodes.forEach((node) => {
      const haystack = `${node.title} ${node.url} ${node.type} ${node.cluster} ${node.keywords.join(" ")}`.toLowerCase();
      if (haystack.includes(q) || fuzzyIncludes(haystack, q)) state.searchIds.add(node.id);
    });
    const first = state.nodes.find((node) => state.searchIds.has(node.id) && visibleNode(node));
    if (first) focusNode(first, 1.18);
    showToast(state.searchIds.size ? `${state.searchIds.size} matching nodes highlighted` : "No matching nodes yet");
  }

  function fuzzyIncludes(haystack, needle) {
    let index = 0;
    for (const char of haystack) {
      if (char === needle[index]) index += 1;
      if (index === needle.length) return true;
    }
    return false;
  }

  function exportGraph(format) {
    const name = safeFilePart(state.host);
    const nodes = state.nodes.filter((node) => node.discovered);
    const edges = state.edges.filter((edge) => edge.discovered);

    if (format === "png") {
      canvas.toBlob((blob) => download(`${name}-webgraph.png`, blob));
      return;
    }

    if (format === "pdf") {
      window.print();
      showToast("Print dialog opened. Choose Save as PDF for the report.");
      return;
    }

    const exporters = {
      json: () => ({
        mime: "application/json",
        ext: "json",
        body: JSON.stringify({ metadata: state.metadata, nodes, edges }, null, 2)
      }),
      csv: () => ({
        mime: "text/csv",
        ext: "csv",
        body: toCsv(nodes, edges)
      }),
      svg: () => ({
        mime: "image/svg+xml",
        ext: "svg",
        body: toSvg(nodes, edges)
      }),
      graphml: () => ({
        mime: "application/xml",
        ext: "graphml",
        body: toGraphMl(nodes, edges)
      }),
      mermaid: () => ({
        mime: "text/markdown",
        ext: "mmd",
        body: toMermaid(nodes, edges)
      }),
      html: () => ({
        mime: "text/html",
        ext: "html",
        body: toInteractiveHtml(nodes, edges)
      }),
      markdown: () => ({
        mime: "text/markdown",
        ext: "md",
        body: toMarkdown(nodes, edges)
      })
    };

    const result = exporters[format]?.();
    if (!result) return;
    download(`${name}-webgraph.${result.ext}`, new Blob([result.body], { type: result.mime }));
  }

  function toCsv(nodes, edges) {
    const nodeRows = ["kind,id,title,type,url,status,cluster"].concat(
      nodes.map((node) => ["node", node.id, node.title, node.type, node.url, node.status, node.cluster].map(csvCell).join(","))
    );
    const edgeRows = ["kind,id,source,target,type,label"].concat(
      edges.map((edge) => ["edge", edge.id, edge.source, edge.target, edge.type, edge.label].map(csvCell).join(","))
    );
    return nodeRows.concat([""], edgeRows).join("\n");
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function toSvg(nodes, edges) {
    const bounds = graphBounds(nodes);
    const width = 1200;
    const height = 780;
    const scale = Math.min((width - 120) / Math.max(1, bounds.width), (height - 120) / Math.max(1, bounds.height));
    const point = (node) => ({
      x: (node.x - bounds.minX) * scale + 60,
      y: (node.y - bounds.minY) * scale + 60
    });
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#090909"/>
  ${edges.map((edge) => {
    const a = point(state.nodeById.get(edge.source));
    const b = point(state.nodeById.get(edge.target));
    return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="${edgeColor[edge.type] || "#f4f7ff"}" stroke-opacity="0.5"/>`;
  }).join("\n  ")}
  ${nodes.map((node) => {
    const p = point(node);
    return `<g><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${node.radius}" fill="${typeColor[node.type] || "#f4f7ff"}"/><text x="${(p.x + 16).toFixed(1)}" y="${(p.y + 4).toFixed(1)}" fill="#f6f7fb" font-family="system-ui" font-size="12">${esc(node.title)}</text></g>`;
  }).join("\n  ")}
</svg>`;
  }

  function toGraphMl(nodes, edges) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <graph id="${esc(state.host)}" edgedefault="directed">
${nodes.map((node) => `    <node id="${esc(node.id)}"><data key="title">${esc(node.title)}</data><data key="url">${esc(node.url)}</data><data key="type">${esc(node.type)}</data></node>`).join("\n")}
${edges.map((edge) => `    <edge id="${esc(edge.id)}" source="${esc(edge.source)}" target="${esc(edge.target)}"><data key="type">${esc(edge.type)}</data></edge>`).join("\n")}
  </graph>
</graphml>`;
  }

  function toMermaid(nodes, edges) {
    const ids = new Map(nodes.map((node, index) => [node.id, `N${index}`]));
    return ["graph TD"].concat(
      nodes.map((node) => `  ${ids.get(node.id)}["${node.title.replaceAll('"', "'")}"]`),
      edges.map((edge) => `  ${ids.get(edge.source)} -->|${edge.type}| ${ids.get(edge.target)}`)
    ).join("\n");
  }

  function toMarkdown(nodes, edges) {
    const byType = statDefs
      .filter((stat) => !stat.edge)
      .map((stat) => `- ${stat.label}: ${nodes.filter((node) => stat.types.includes(node.type)).length}`)
      .join("\n");
    return `# WebGraph Report: ${state.host}

${state.metadata.summary}

## Site Intelligence

- Hosting provider: ${state.metadata.hosting}
- Framework: ${state.metadata.framework}
- CMS: ${state.metadata.cms}
- Analytics: ${state.metadata.analytics}
- Robots.txt: ${state.metadata.robots}
- Sitemap: ${state.metadata.sitemap}
- Security headers: ${state.metadata.securityHeaders}
- Performance score: ${state.metadata.performanceScore}
- Risk score: ${state.metadata.riskScore}

## Discovery Counts

${byType}
- Requests: ${edges.length}

## Notable Endpoints

${nodes.slice(0, 24).map((node) => `- ${node.title} (${node.type}, ${node.status}): ${node.url}`).join("\n")}
`;
  }

  function toInteractiveHtml(nodes, edges) {
    const data = JSON.stringify({
      host: state.host,
      nodes: nodes.map((node) => ({ id: node.id, title: node.title, type: node.type, x: node.x, y: node.y, url: node.url })),
      edges: edges.map((edge) => ({ source: edge.source, target: edge.target, type: edge.type }))
    });
    return `<!doctype html><html><head><meta charset="utf-8"><title>WebGraph Export - ${esc(state.host)}</title><style>
body{margin:0;background:#090909;color:#f6f7fb;font-family:Inter,system-ui,sans-serif;overflow:hidden}canvas{display:block}aside{position:fixed;top:18px;left:18px;padding:14px 16px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:rgba(20,21,24,.72);backdrop-filter:blur(18px)}small{color:#9aa0aa}
</style></head><body><canvas id="c"></canvas><aside><strong>WebGraph Export</strong><br><small>${esc(state.host)} - drag to pan, wheel to zoom</small></aside><script>
const data=${data};const c=document.getElementById("c"),x=c.getContext("2d");let w,h,z=.75,cx=0,cy=0,pan=null;const colors=${JSON.stringify(typeColor)},edgeColors=${JSON.stringify(edgeColor)};function resize(){w=c.width=innerWidth;h=c.height=innerHeight}addEventListener("resize",resize);resize();function p(n){return{x:(n.x-cx)*z+w/2,y:(n.y-cy)*z+h/2}}function draw(){x.clearRect(0,0,w,h);x.lineCap="round";data.edges.forEach(e=>{const a=data.nodes.find(n=>n.id===e.source),b=data.nodes.find(n=>n.id===e.target);if(!a||!b)return;const pa=p(a),pb=p(b);x.globalAlpha=.5;x.strokeStyle=edgeColors[e.type]||"#fff";x.beginPath();x.moveTo(pa.x,pa.y);x.lineTo(pb.x,pb.y);x.stroke()});data.nodes.forEach(n=>{const q=p(n);x.globalAlpha=1;x.shadowBlur=18;x.shadowColor=colors[n.type]||"#fff";x.fillStyle=colors[n.type]||"#fff";x.beginPath();x.arc(q.x,q.y,8*z+5,0,Math.PI*2);x.fill();x.shadowBlur=0;x.fillStyle="#f6f7fb";x.font="12px system-ui";x.fillText(n.title,q.x+12,q.y+4)});requestAnimationFrame(draw)}draw();c.onpointerdown=e=>pan={x:e.clientX,y:e.clientY,cx,cy};c.onpointermove=e=>{if(pan){cx=pan.cx-(e.clientX-pan.x)/z;cy=pan.cy-(e.clientY-pan.y)/z}};c.onpointerup=()=>pan=null;c.onwheel=e=>{e.preventDefault();z=Math.max(.2,Math.min(2.5,z*(e.deltaY>0?.9:1.1)))};
</script></body></html>`;
  }

  function download(filename, blob) {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(`Exported ${filename}`);
  }

  function snippetFor(action, node) {
    if (action === "scraper") {
      return `import requests\nfrom bs4 import BeautifulSoup\n\nurl = "${node.url}"\nhtml = requests.get(url, timeout=20).text\nsoup = BeautifulSoup(html, "html.parser")\nprint(soup.title.string if soup.title else url)`;
    }
    if (action === "playwright") {
      return `import { test, expect } from "@playwright/test";\n\ntest("inspect ${node.title}", async ({ page }) => {\n  const response = await page.goto("${node.url}");\n  expect(response?.status()).toBeLessThan(500);\n});`;
    }
    if (action === "curl") {
      return `curl -i "${node.url}" \\\n  -H "accept: ${node.contentType.includes("json") ? "application/json" : "*/*"}"`;
    }
    if (action === "client") {
      return `export async function request${toIdentifier(node.title)}() {\n  const response = await fetch("${node.url}");\n  if (!response.ok) throw new Error(\`HTTP \${response.status}\`);\n  return response.headers.get("content-type")?.includes("json") ? response.json() : response.text();\n}`;
    }
    if (action === "request") {
      return `${node.status} ${node.url}\n${Object.entries(node.headers).map(([key, value]) => `${key}: ${value}`).join("\n")}`;
    }
    return node.url;
  }

  function toIdentifier(value) {
    const cleaned = value.replace(/[^a-z0-9]+/gi, " ").trim().split(/\s+/).map((part) => part[0]?.toUpperCase() + part.slice(1)).join("");
    return cleaned || "Endpoint";
  }

  async function copyText(text, label = "Copied") {
    try {
      await navigator.clipboard.writeText(text);
      showToast(label);
    } catch {
      showToast("Clipboard blocked by the browser. The snippet is visible in the inspector.");
    }
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("is-visible");
    window.clearTimeout(showToast.handle);
    showToast.handle = window.setTimeout(() => els.toast.classList.remove("is-visible"), 2200);
  }

  function hexToRgba(hex, alpha) {
    const value = hex.replace("#", "");
    const bigint = Number.parseInt(value, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function bindEvents() {
    window.addEventListener("resize", resize);

    els.urlForm.addEventListener("submit", (event) => {
      event.preventDefault();
      startLiveScan(els.urlInput.value);
    });

    document.querySelectorAll(".mode").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".mode").forEach((candidate) => candidate.classList.remove("is-active"));
        button.classList.add("is-active");
        state.layout = button.dataset.layout;
        els.app.dataset.mode = state.layout;
        applyLayoutTargets();
        showToast(`${button.textContent} layout`);
      });
    });

    els.fitButton.addEventListener("click", () => {
      state.autoFollow = false;
      fitGraph();
    });

    els.filters.addEventListener("change", (event) => {
      const input = event.target.closest("input[data-layer]");
      if (!input) return;
      if (input.checked) state.activeFilters.add(input.dataset.layer);
      else state.activeFilters.delete(input.dataset.layer);
      updateStats();
    });

    els.clusterList.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-cluster]");
      if (!chip) return;
      const cluster = chip.dataset.cluster;
      if (state.collapsedClusters.has(cluster)) {
        state.collapsedClusters.delete(cluster);
        chip.classList.remove("is-collapsed");
      } else {
        state.collapsedClusters.add(cluster);
        chip.classList.add("is-collapsed");
      }
    });

    els.searchInput.addEventListener("input", () => runSearch(els.searchInput.value));

    els.closeInspector.addEventListener("click", () => {
      state.selectedId = null;
      updateInspector();
    });

    els.inspector.addEventListener("click", (event) => {
      const button = event.target.closest("[data-focus-node]");
      if (!button) return;
      const node = state.nodeById.get(button.dataset.focusNode);
      if (node) selectNode(node, true);
    });

    els.replayButton.addEventListener("click", () => {
      closeLiveScan();
      resetDiscovery(els.reverseToggle.checked ? "reverse" : "forward");
      showToast(els.reverseToggle.checked ? "Replaying discovery in reverse" : "Replaying discovery");
    });

    els.pauseButton.addEventListener("click", () => {
      state.scan.paused = !state.scan.paused;
      els.pauseButton.innerHTML = state.scan.paused
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14"/><path d="M16 5v14"/></svg>';
      els.pauseButton.title = state.scan.paused ? "Resume discovery" : "Pause discovery";
    });

    els.speedRange.addEventListener("input", () => {
      state.scan.speed = Number(els.speedRange.value);
    });

    els.exportButton.addEventListener("click", () => exportGraph(els.exportFormat.value));

    canvas.addEventListener("pointerdown", (event) => {
      hideContextMenu();
      canvas.setPointerCapture(event.pointerId);
      const node = findNodeAt(event.offsetX, event.offsetY);
      state.pointer.downX = event.offsetX;
      state.pointer.downY = event.offsetY;
      if (node) {
        state.dragNode = node;
        state.selectedId = node.id;
        updateInspector();
        const world = screenToWorld(event.offsetX, event.offsetY);
        state.pointer.worldX = world.x - node.x;
        state.pointer.worldY = world.y - node.y;
      } else {
        state.pan = {
          x: event.offsetX,
          y: event.offsetY,
          cameraX: state.camera.targetX,
          cameraY: state.camera.targetY
        };
      }
      canvas.classList.add("dragging");
    });

    canvas.addEventListener("pointermove", (event) => {
      state.pointer.x = event.offsetX;
      state.pointer.y = event.offsetY;
      if (state.dragNode) {
        const world = screenToWorld(event.offsetX, event.offsetY);
        state.dragNode.x = world.x - state.pointer.worldX;
        state.dragNode.y = world.y - state.pointer.worldY;
        state.dragNode.vx = 0;
        state.dragNode.vy = 0;
        state.dragNode.pinned = true;
        state.autoFollow = false;
      } else if (state.pan) {
        const dx = (event.offsetX - state.pan.x) / state.camera.zoom;
        const dy = (event.offsetY - state.pan.y) / state.camera.zoom;
        state.camera.targetX = state.pan.cameraX - dx;
        state.camera.targetY = state.pan.cameraY - dy;
        state.autoFollow = false;
      }
      updateHover(event.offsetX, event.offsetY);
    });

    canvas.addEventListener("pointerup", (event) => {
      const wasDragNode = state.dragNode;
      const moved = Math.hypot(event.offsetX - state.pointer.downX, event.offsetY - state.pointer.downY) > 4;
      state.dragNode = null;
      state.pan = null;
      canvas.classList.remove("dragging");
      if (wasDragNode && !moved) {
        selectNode(wasDragNode, true);
      }
    });

    canvas.addEventListener("pointerleave", () => {
      state.hoverId = null;
      state.dragNode = null;
      state.pan = null;
      canvas.classList.remove("dragging");
    });

    canvas.addEventListener("dblclick", (event) => {
      const node = findNodeAt(event.offsetX, event.offsetY);
      if (node) {
        selectNode(node, true);
        focusNode(node, Math.min(2.2, state.camera.targetZoom * 1.55));
      }
    });

    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const before = screenToWorld(event.offsetX, event.offsetY);
      const factor = event.deltaY > 0 ? 0.88 : 1.14;
      const nextZoom = clamp(state.camera.targetZoom * factor, 0.18, 2.8);
      state.camera.targetZoom = nextZoom;
      const after = screenToWorld(event.offsetX, event.offsetY);
      state.camera.targetX += before.x - after.x;
      state.camera.targetY += before.y - after.y;
      state.autoFollow = false;
    }, { passive: false });

    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const node = findNodeAt(event.offsetX, event.offsetY);
      if (!node) return;
      state.contextNodeId = node.id;
      els.contextMenu.style.left = `${event.clientX}px`;
      els.contextMenu.style.top = `${event.clientY}px`;
      els.contextMenu.classList.add("is-open");
    });

    els.contextMenu.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const node = state.nodeById.get(state.contextNodeId);
      if (!node) return;
      handleContextAction(button.dataset.action, node);
      hideContextMenu();
    });

    document.addEventListener("pointerdown", (event) => {
      if (!event.target.closest("#contextMenu")) hideContextMenu();
    });

    miniMap.addEventListener("pointerdown", (event) => {
      state.miniDrag = true;
      moveCameraFromMini(event);
    });
    miniMap.addEventListener("pointermove", (event) => {
      if (state.miniDrag) moveCameraFromMini(event);
    });
    miniMap.addEventListener("pointerup", () => {
      state.miniDrag = false;
    });
    miniMap.addEventListener("pointerleave", () => {
      state.miniDrag = false;
    });
  }

  function handleContextAction(action, node) {
    if (action === "inspect") {
      selectNode(node, true);
      return;
    }
    if (action === "open") {
      window.open(node.url, "_blank", "noopener");
      return;
    }
    if (action === "copy") {
      copyText(node.url, "Endpoint copied");
      return;
    }
    if (action === "pin") {
      node.pinned = !node.pinned;
      showToast(node.pinned ? "Node pinned" : "Node released");
      return;
    }
    if (action === "hide") {
      node.hidden = true;
      showToast("Node hidden");
      return;
    }
    if (action === "expand") {
      state.edges.forEach((edge) => {
        if (edge.source === node.id) revealNode(state.nodeById.get(edge.target), "Expanded");
        if (edge.target === node.id) revealNode(state.nodeById.get(edge.source), "Expanded");
      });
      showToast("Neighbors expanded");
      return;
    }
    const snippet = snippetFor(action, node);
    copyText(snippet, `${buttonLabel(action)} copied`);
    state.selectedId = node.id;
    updateInspector();
  }

  function buttonLabel(action) {
    const labels = {
      scraper: "Scraper",
      playwright: "Playwright code",
      curl: "cURL",
      client: "API client",
      request: "Request"
    };
    return labels[action] || "Snippet";
  }

  function hideContextMenu() {
    els.contextMenu.classList.remove("is-open");
  }

  function moveCameraFromMini(event) {
    const nodes = state.nodes.filter(visibleNode);
    if (!nodes.length) return;
    const rect = miniMap.getBoundingClientRect();
    const bounds = graphBounds(nodes);
    const scale = Math.min((rect.width - 24) / Math.max(1, bounds.width), (rect.height - 24) / Math.max(1, bounds.height));
    state.camera.targetX = bounds.minX + (event.offsetX - 12) / scale;
    state.camera.targetY = bounds.minY + (event.offsetY - 12) / scale;
    state.autoFollow = false;
  }

  function tick(time) {
    state.frame += 1;
    state.time = time;
    const dt = clamp((time - state.lastTime) / 16.67, 0.35, 2.2) || 1;
    state.lastTime = time;
    updateCamera();
    updatePhysics(dt);
    draw();
    requestAnimationFrame(tick);
  }

  function init() {
    resize();
    bindEvents();
    startLiveScan(els.urlInput.value);
    requestAnimationFrame(tick);
  }

  init();
})();
