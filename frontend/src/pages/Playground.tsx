import { useState } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

function Playground() {
  const [apiKey, setApiKey] = useState('');
  const [prompt, setPrompt] = useState('微距镜头对准叶片上翠绿的玻璃蛙...');
  const [response, setResponse] = useState<any>(null);
  const [taskId, setTaskId] = useState('');
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await axios.post(
        '/api/v1/doubao/create',
        {
          model: "doubao-seedance-2-0-260128",
          content: [{ type: "text", text: prompt }],
          generate_audio: true,
          ratio: "16:9",
          duration: 5
        },
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      setResponse(res.data);
      if (res.data.id) setTaskId(res.data.id);
    } catch (err: any) {
      setResponse(err.response?.data || err.message);
    }
    setLoading(false);
  };

  const handleGetResult = async () => {
    setLoading(true);
    try {
      const res = await axios.post(
        '/api/v1/doubao/get_result',
        { id: taskId },
        { headers: { Authorization: `Bearer ${apiKey}` } }
      );
      setResponse(res.data);
    } catch (err: any) {
      setResponse(err.response?.data || err.message);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm">
        <h1 className="text-2xl font-bold">API Playground</h1>
        <Link to="/dashboard" className="text-blue-600 hover:underline">Back to Dashboard</Link>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Your API Key (sk-...)</label>
          <input
            type="text"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full px-4 py-2 border rounded-md font-mono text-sm"
            placeholder="sk-xxxxxxxx"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Text Prompt</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full px-4 py-2 border rounded-md h-32 text-sm"
          />
        </div>

        <div className="flex gap-4">
          <button onClick={handleCreate} disabled={loading} className="bg-blue-600 text-white px-6 py-2 rounded-md hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Sending...' : 'Create Video Task'}
          </button>
        </div>

        <hr className="my-6" />

        <div>
          <label className="block text-sm font-medium mb-1">Task ID (for checking result)</label>
          <div className="flex gap-4">
            <input
              type="text"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="flex-1 px-4 py-2 border rounded-md font-mono text-sm"
              placeholder="Enter Task ID"
            />
            <button onClick={handleGetResult} disabled={loading} className="bg-green-600 text-white px-6 py-2 rounded-md hover:bg-green-700 disabled:opacity-50">
              {loading ? 'Polling...' : 'Get Result'}
            </button>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2">Response:</h3>
          <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto text-sm text-gray-800">
            {response ? JSON.stringify(response, null, 2) : 'No response yet'}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default Playground;
