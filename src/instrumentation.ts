// Starts the background job-discovery scheduler once per server process.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV !== "test" && process.env.DISABLE_SCHEDULER !== "true") {
    const { startScheduler } = await import("./lib/jobs/discovery");
    startScheduler();
  }
}
