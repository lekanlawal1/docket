// Every tool, grouped into piers. A tool with `soon: true` is listed but not built yet;
// the page says so rather than hiding it.

export const PIERS = [
  { no: "01", name: "Organise", blurb: "Put pages in order", tint: "--tint-1", tools: [
    { id: "merge", name: "Merge", icon: "knot", what: "Join several PDFs into one, in the order you choose." },
    { id: "split", name: "Split", icon: "crab", what: "Break a PDF apart by page ranges or every few pages." },
    { id: "organise", name: "Organise pages", icon: "wheel", what: "Reorder, rotate and delete pages." },
    { id: "extract", name: "Extract pages", icon: "hook", what: "Pull the pages you need into a new file." },
  ] },
  { no: "02", name: "Convert", blurb: "Change the format", tint: "--tint-2", tools: [
    { id: "pdf-to-jpg", name: "PDF to JPG", icon: "porthole", what: "Every page as an image, at the size you pick." },
    { id: "images-to-pdf", name: "Images to PDF", icon: "shell", what: "Photos and scans into one tidy PDF." },
    { id: "pdf-to-word", name: "PDF to Word", icon: "sailboat", what: "Text and paragraphs into an editable document.", soon: true },
    { id: "pdf-to-text", name: "PDF to text", icon: "bottle", what: "Just the words, ready to paste." },
  ] },
  { no: "03", name: "Edit and sign", blurb: "Mark it up and make it yours", tint: "--tint-3", tools: [
    { id: "sign", name: "Sign", icon: "anchor", what: "Draw or type a signature and place it on the page." },
    { id: "fill-form", name: "Fill a form", icon: "lifebuoy", what: "Type into a PDF's form fields and save." },
    { id: "page-numbers", name: "Page numbers", icon: "compass", what: "Add numbers where you want them." },
    { id: "watermark", name: "Watermark", icon: "wave", what: "Stamp text across every page." },
  ] },
  { no: "04", name: "Protect", blurb: "Keep what's private, private", tint: "--tint-4", tools: [
    { id: "redact", name: "Redact", icon: "octopus", what: "Black out text for real, then check it's gone." },
    { id: "password", name: "Password", icon: "chest", what: "Lock a PDF, or unlock one you have the password for." },
    { id: "metadata", name: "Remove metadata", icon: "jelly", what: "See and strip the author, dates and hidden details." },
  ] },
  { no: "05", name: "Shrink and fix", blurb: "Smaller, cleaner files", tint: "--tint-5", tools: [
    { id: "compress", name: "Compress", icon: "puffer", what: "Make a scanned PDF small enough to email or upload." },
    { id: "searchable", name: "Make searchable", icon: "spyglass", what: "Read the text in a scan so you can search it.", soon: true },
    { id: "grayscale", name: "Grayscale", icon: "gull", what: "Drop the colour to save ink." },
  ] },
  { no: "06", name: "Read", blurb: "Understand it faster", tint: "--tint-6", tools: [
    { id: "summary", name: "Summary", icon: "lighthouse", what: "The key sentences, taken word for word from the file." },
    { id: "find", name: "Find dates and amounts", icon: "net", what: "Every date, amount, email and link in one list." },
  ] },
  { no: "07", name: "Images and makers", blurb: "The small jobs", tint: "--tint-7", tools: [
    { id: "resize-image", name: "Resize image", icon: "star", what: "By pixels, percent, or presets like a passport photo." },
    { id: "compress-image", name: "Compress image", icon: "fish", what: "Under a size limit, like 200 KB for a job portal." },
    { id: "qr", name: "QR code", icon: "flag", what: "For a link, Wi-Fi network or contact card." },
    { id: "paper", name: "Lined paper", icon: "map", what: "Lined, grid or dotted pages to print." },
  ] },
];

// berth numbers run across all piers: B-01 is the first tool on pier 01, and so on
let n = 0;
for (const pier of PIERS) {
  for (const tool of pier.tools) {
    n += 1;
    tool.berth = "B-" + String(n).padStart(2, "0");
    tool.pier = pier;
  }
}

export const TOOLS = PIERS.flatMap((p) => p.tools);
export const findTool = (id) => TOOLS.find((t) => t.id === id);
