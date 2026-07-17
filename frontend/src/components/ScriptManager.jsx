import { useState, useEffect } from "react";
import { Search, Plus, Edit, Trash2, Check, FileText, Clock } from "lucide-react";
import axios from "axios";

const API_BASE = "http://localhost:8000";

function ScriptManager() {
    const [scripts, setScripts] = useState([]);
    const [activeScript, setActiveScript] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editingScript, setEditingScript] = useState(null);
    const [showForm, setShowForm] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [formData, setFormData] = useState({
        name: "",
        script: {
            instructions: "You are a helpful AI assistant. Start by greeting the user and asking for their name. Then ask for their email address. Once you have both, confirm the information and end the conversation.",
        },
        is_active: false,
    });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(null);

    useEffect(() => {
        fetchScripts();
        fetchActiveScript();
    }, []);

    const fetchScripts = async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${API_BASE}/scripts`);
            if (response.data.success) {
                setScripts(response.data.scripts || []);
            }
        } catch (err) {
            setError("Failed to load scripts");
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const fetchActiveScript = async () => {
        try {
            const response = await axios.get(`${API_BASE}/scripts/active`);
            if (response.data.success) {
                setActiveScript(response.data.script);
            }
        } catch (err) {
            console.error("Failed to load active script:", err);
        }
    };

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        if (name.startsWith("script.")) {
            const field = name.split(".")[1];
            setFormData({
                ...formData,
                script: {
                    ...formData.script,
                    [field]: value,
                },
            });
        } else {
            setFormData({
                ...formData,
                [name]: value,
            });
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            setLoading(true);
            setError(null);
            setSuccess(null);

            const payload = {
                name: formData.name.trim(),
                script: formData.script,
                is_active: formData.is_active,
            };

            if (isEditing && editingScript) {
                await axios.put(`${API_BASE}/scripts/${editingScript.name}`, payload);
                setSuccess("Script updated successfully!");
            } else {
                await axios.post(`${API_BASE}/scripts`, payload);
                setSuccess("Script created successfully!");
            }

            setIsEditing(false);
            setEditingScript(null);
            setShowForm(false);
            setFormData({
                name: "",
                script: {
                    instructions: "You are a helpful AI assistant. Start by greeting the user and asking for their name. Then ask for their email address. Once you have both, confirm the information and end the conversation.",
                },
                is_active: false,
            });

            fetchScripts();
            fetchActiveScript();

            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError(isEditing ? "Failed to update script" : "Failed to create script");
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleEdit = (script) => {
        setIsEditing(true);
        setEditingScript(script);
        setFormData({
            name: script.name,
            script: script.script,
            is_active: script.is_active,
        });
        setShowForm(true);
    };

    const handleDelete = async (scriptName) => {
        if (!window.confirm(`Are you sure you want to delete the script "${scriptName}"?`)) {
            return;
        }

        try {
            setLoading(true);
            await axios.delete(`${API_BASE}/scripts/${scriptName}`);
            setSuccess("Script deleted successfully!");
            fetchScripts();
            fetchActiveScript();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError("Failed to delete script");
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleActivate = async (scriptName) => {
        try {
            setLoading(true);
            await axios.post(`${API_BASE}/scripts/${scriptName}/activate`);
            setSuccess(`Script "${scriptName}" activated successfully!`);
            fetchScripts();
            fetchActiveScript();
            setTimeout(() => setSuccess(null), 3000);
        } catch (err) {
            setError("Failed to activate script");
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = () => {
        setIsEditing(false);
        setEditingScript(null);
        setShowForm(false);
        setFormData({
            name: "",
            script: {
                instructions: "You are a helpful AI assistant. Start by greeting the user and asking for their name. Then ask for their email address. Once you have both, confirm the information and end the conversation.",
            },
            is_active: false,
        });
    };

    const handleCreateNew = () => {
        setIsEditing(false);
        setEditingScript(null);
        setFormData({
            name: "",
            script: {
                instructions: "You are a helpful AI assistant. Start by greeting the user and asking for their name. Then ask for their email address. Once you have both, confirm the information and end the conversation.",
            },
            is_active: false,
        });
        setShowForm(true);
    };

    const filteredScripts = scripts.filter(script =>
        script.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        script.script.instructions?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="max-w-6xl mx-auto">
            <div className="mb-8">
                <h2 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
                    Script Manager
                </h2>
                <p className="text-slate-600 dark:text-slate-400">
                    Create and manage custom behavior scripts for the AI agent
                </p>
            </div>

            {error && (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-red-600 dark:text-red-400 mb-6">
                    {error}
                </div>
            )}
            
            {success && (
                <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-green-600 dark:text-green-400 mb-6">
                    {success}
                </div>
            )}

            {/* Header Actions */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search scripts..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    />
                </div>
                <button
                    onClick={handleCreateNew}
                    className="px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 transform hover:-translate-y-0.5 transition-all duration-200 flex items-center gap-2"
                >
                    <Plus className="w-5 h-5" />
                    Create Script
                </button>
            </div>

            {/* Form Modal */}
            {showForm && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6 border-b border-slate-200 dark:border-slate-800">
                            <h3 className="text-2xl font-bold text-slate-900 dark:text-white">
                                {isEditing ? "Edit Script" : "Create New Script"}
                            </h3>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-6">
                            <div>
                                <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                    Script Name *
                                </label>
                                <input
                                    type="text"
                                    id="name"
                                    name="name"
                                    value={formData.name}
                                    onChange={handleInputChange}
                                    required
                                    disabled={isEditing}
                                    placeholder="e.g., Customer Service Script"
                                    className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                />
                            </div>

                            <div>
                                <label htmlFor="script.instructions" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                                    Agent Instructions *
                                </label>
                                <textarea
                                    id="script.instructions"
                                    name="script.instructions"
                                    value={formData.script.instructions}
                                    onChange={handleInputChange}
                                    rows="12"
                                    required
                                    placeholder="Write detailed instructions for how the AI agent should behave. For example:
- Greet the user warmly
- Ask for their name and email
- If they provide both, confirm and thank them
- Keep responses short and friendly
- Always be polite and professional"
                                    className="w-full px-4 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all resize-none"
                                />
                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                    The agent will follow these instructions exactly. Be specific about what you want it to do.
                                </p>
                            </div>

                            <div className="flex items-center gap-3">
                                <input
                                    type="checkbox"
                                    id="is_active"
                                    name="is_active"
                                    checked={formData.is_active}
                                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                                    className="w-5 h-5 rounded border-slate-300 text-blue-500 focus:ring-blue-500"
                                />
                                <label htmlFor="is_active" className="text-sm text-slate-700 dark:text-slate-300">
                                    Set as active script (will deactivate all other scripts)
                                </label>
                            </div>

                            <div className="flex gap-3 pt-4">
                                <button
                                    type="submit"
                                    className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-semibold rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 transform hover:-translate-y-0.5 transition-all duration-200"
                                    disabled={loading}
                                >
                                    {loading ? "Saving..." : isEditing ? "Update Script" : "Create Script"}
                                </button>
                                <button
                                    type="button"
                                    onClick={handleCancel}
                                    className="px-6 py-3 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all"
                                >
                                    Cancel
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Scripts Grid */}
            {loading && scripts.length === 0 ? (
                <div className="text-center py-16 text-slate-500 dark:text-slate-400">
                    Loading scripts...
                </div>
            ) : filteredScripts.length === 0 ? (
                <div className="text-center py-16 text-slate-400 italic">
                    {searchQuery ? "No scripts found matching your search" : "No scripts found. Create your first script!"}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredScripts.map((script) => (
                        <div
                            key={script.name}
                            className={`bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-2xl border ${
                                script.is_active
                                    ? "border-green-500/50 shadow-lg shadow-green-500/10"
                                    : "border-slate-200 dark:border-slate-800"
                            } shadow-xl overflow-hidden transition-all hover:shadow-2xl hover:-translate-y-1`}
                        >
                            {/* Card Header */}
                            <div className="p-6 border-b border-slate-200 dark:border-slate-800">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                                            script.is_active
                                                ? "bg-green-500/20 text-green-500"
                                                : "bg-blue-500/20 text-blue-500"
                                        }`}>
                                            <FileText className="w-5 h-5" />
                                        </div>
                                        <div>
                                            <h4 className="font-semibold text-slate-900 dark:text-white">
                                                {script.name}
                                            </h4>
                                            {script.is_active && (
                                                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-500 bg-green-500/10 px-2 py-1 rounded-full mt-1">
                                                    <Check className="w-3 h-3" />
                                                    Active
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Card Body */}
                            <div className="p-6">
                                <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-3 mb-4">
                                    {script.script.instructions?.substring(0, 150)}...
                                </p>
                                <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                    <Clock className="w-3 h-3" />
                                    Updated: {new Date(script.updated_at).toLocaleDateString()}
                                </div>
                            </div>

                            {/* Card Actions */}
                            <div className="p-4 border-t border-slate-200 dark:border-slate-800 flex gap-2">
                                {!script.is_active && (
                                    <button
                                        onClick={() => handleActivate(script.name)}
                                        className="flex-1 px-3 py-2 bg-green-500/10 text-green-500 rounded-lg hover:bg-green-500/20 transition-colors font-medium text-sm flex items-center justify-center gap-2"
                                    >
                                        <Check className="w-4 h-4" />
                                        Activate
                                    </button>
                                )}
                                <button
                                    onClick={() => handleEdit(script)}
                                    className="flex-1 px-3 py-2 bg-blue-500/10 text-blue-500 rounded-lg hover:bg-blue-500/20 transition-colors font-medium text-sm flex items-center justify-center gap-2"
                                >
                                    <Edit className="w-4 h-4" />
                                    Edit
                                </button>
                                <button
                                    onClick={() => handleDelete(script.name)}
                                    className="px-3 py-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500/20 transition-colors font-medium text-sm flex items-center justify-center"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default ScriptManager;
