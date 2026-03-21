import { useState, useMemo } from 'react';
import axios from 'axios';
import { Link } from 'react-router-dom';

interface RefItem {
  id: number;
  url: string;
}

let nextId = 1;

function Playground() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('doubao-seedance-2-0-260128');
  const [prompt, setPrompt] = useState('微距镜头对准叶片上翠绿的玻璃蛙...');
  const [refImages, setRefImages] = useState<RefItem[]>([]);
  const [refVideos, setRefVideos] = useState<RefItem[]>([]);
  const [refAudios, setRefAudios] = useState<RefItem[]>([]);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [ratio, setRatio] = useState('16:9');
  const [duration, setDuration] = useState(5);
  const [watermark, setWatermark] = useState(false);
  const [response, setResponse] = useState<any>(null);
  const [taskId, setTaskId] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const addItem = (setter: React.Dispatch<React.SetStateAction<RefItem[]>>) => {
    setter(prev => [...prev, { id: nextId++, url: '' }]);
  };

  const removeItem = (setter: React.Dispatch<React.SetStateAction<RefItem[]>>, id: number) => {
    setter(prev => prev.filter(item => item.id !== id));
  };

  const updateItem = (setter: React.Dispatch<React.SetStateAction<RefItem[]>>, id: number, url: string) => {
    setter(prev => prev.map(item => item.id === id ? { ...item, url } : item));
  };

  const buildRequestBody = () => {
    const content: any[] = [{ type: 'text', text: prompt }];

    refImages.forEach(img => {
      if (img.url.trim()) {
        content.push({
          type: 'image_url',
          image_url: { url: img.url.trim() },
          role: 'reference_image'
        });
      }
    });

    refVideos.forEach(vid => {
      if (vid.url.trim()) {
        content.push({
          type: 'video_url',
          video_url: { url: vid.url.trim() },
          role: 'reference_video'
        });
      }
    });

    refAudios.forEach(aud => {
      if (aud.url.trim()) {
        content.push({
          type: 'audio_url',
          audio_url: { url: aud.url.trim() },
          role: 'reference_audio'
        });
      }
    });

    return {
      model,
      content,
      generate_audio: generateAudio,
      ratio,
      duration,
      watermark
    };
  };

  const requestBody = useMemo(() => buildRequestBody(), [model, prompt, refImages, refVideos, refAudios, generateAudio, ratio, duration, watermark]);

  const handleCreate = async () => {
    setLoading(true);
    try {
      const res = await axios.post(
        '/api/v1/doubao/create',
        requestBody,
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

  const RefSection = ({
    title,
    items,
    setter,
    placeholder,
    icon
  }: {
    title: string;
    items: RefItem[];
    setter: React.Dispatch<React.SetStateAction<RefItem[]>>;
    placeholder: string;
    icon: string;
  }) => (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
          <span>{icon}</span> {title}
          <span className="text-xs text-gray-400 font-normal">({items.length})</span>
        </label>
        <button
          type="button"
          onClick={() => addItem(setter)}
          className="text-xs px-2.5 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors font-medium"
        >
          + Add
        </button>
      </div>
      {items.map(item => (
        <div key={item.id} className="flex gap-2">
          <input
            type="text"
            value={item.url}
            onChange={(e) => updateItem(setter, item.id, e.target.value)}
            className="flex-1 px-3 py-1.5 border border-gray-200 rounded-md text-sm font-mono focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
            placeholder={placeholder}
          />
          <button
            type="button"
            onClick={() => removeItem(setter, item.id)}
            className="px-2 py-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors text-sm"
            title="Remove"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex justify-between items-center bg-white p-4 rounded-xl shadow-sm">
        <h1 className="text-2xl font-bold">API Playground</h1>
        <Link to="/dashboard" className="text-blue-600 hover:underline">Back to Dashboard</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left Column: Inputs */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm space-y-5">
          {/* API Key */}
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">🔑 API Key</label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md font-mono text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              placeholder="sk-xxxxxxxx"
            />
          </div>

          {/* Model */}
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">🤖 Model</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md font-mono text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              placeholder="doubao-seedance-2-0-260128"
            />
          </div>

          {/* Text Prompt */}
          <div>
            <label className="block text-sm font-medium mb-1 text-gray-700">📝 Text Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md h-32 text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all resize-y"
            />
          </div>

          {/* Reference Sections */}
          <div className="border-t border-gray-100 pt-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Reference Media</h3>
            <RefSection
              title="Reference Images"
              items={refImages}
              setter={setRefImages}
              placeholder="https://example.com/image.jpg"
              icon="🖼️"
            />
            <RefSection
              title="Reference Videos"
              items={refVideos}
              setter={setRefVideos}
              placeholder="https://example.com/video.mp4"
              icon="🎬"
            />
            <RefSection
              title="Reference Audio"
              items={refAudios}
              setter={setRefAudios}
              placeholder="https://example.com/audio.mp3"
              icon="🎵"
            />
          </div>

          {/* Create Button */}
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleCreate}
              disabled={loading}
              className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium shadow-sm"
            >
              {loading ? 'Sending...' : '🚀 Create Video Task'}
            </button>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="px-4 py-2.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors text-sm font-medium"
            >
              {showPreview ? 'Hide' : 'Show'} Request Preview
            </button>
          </div>

          {/* Request Preview */}
          {showPreview && (
            <div>
              <h3 className="text-sm font-medium mb-2 text-gray-500">Request Body Preview:</h3>
              <pre className="bg-gray-900 text-green-400 p-4 rounded-lg overflow-x-auto text-xs leading-relaxed max-h-80 overflow-y-auto">
                {JSON.stringify(requestBody, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Right Column: Parameters & Results */}
        <div className="space-y-5">
          {/* Parameters */}
          <div className="bg-white p-5 rounded-xl shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Parameters</h3>

            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Ratio</label>
              <select
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all bg-white"
              >
                <option value="16:9">16:9 (Landscape)</option>
                <option value="9:16">9:16 (Portrait)</option>
                <option value="1:1">1:1 (Square)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">Duration (seconds)</label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value) || 5)}
                min={1}
                max={30}
                className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              />
            </div>

            <div className="flex items-center justify-between py-1">
              <label className="text-sm font-medium text-gray-700">Generate Audio</label>
              <button
                type="button"
                onClick={() => setGenerateAudio(!generateAudio)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${generateAudio ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${generateAudio ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            <div className="flex items-center justify-between py-1">
              <label className="text-sm font-medium text-gray-700">Watermark</label>
              <button
                type="button"
                onClick={() => setWatermark(!watermark)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${watermark ? 'bg-blue-600' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${watermark ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          {/* Get Result */}
          <div className="bg-white p-5 rounded-xl shadow-sm space-y-3">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Check Result</h3>
            <input
              type="text"
              value={taskId}
              onChange={(e) => setTaskId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-md font-mono text-sm focus:ring-2 focus:ring-blue-200 focus:border-blue-400 outline-none transition-all"
              placeholder="Task ID"
            />
            <button
              onClick={handleGetResult}
              disabled={loading}
              className="w-full bg-green-600 text-white px-4 py-2.5 rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors font-medium shadow-sm"
            >
              {loading ? 'Polling...' : '📡 Get Result'}
            </button>
          </div>

          {/* Response */}
          <div className="bg-white p-5 rounded-xl shadow-sm">
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Response</h3>
            <pre className="bg-gray-50 p-3 rounded-lg overflow-x-auto text-xs text-gray-800 max-h-64 overflow-y-auto leading-relaxed">
              {response ? JSON.stringify(response, null, 2) : 'No response yet'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Playground;
