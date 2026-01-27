export default function Home() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1>BM Portfolio API Gateway</h1>
      <p>This is an API-only service. Available endpoints:</p>
      <ul>
        <li>
          <code>POST /api/revalidate</code> - Trigger ISR revalidation
        </li>
      </ul>
    </main>
  );
}
