import { useState, useEffect } from "react";
import axios from "axios";

const API_BASE = "http://localhost:8000";

function ScriptManager() {
    const [scripts, setScripts] = useState([]);
    const [activeScript, setActiveScript] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [editingScript, setEditingScript] = useState(null);
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
            setFormData({
                name: "",
                script: {
                    greeting_prompt: "Start the conversation and ask for the user's name",
                    ask_name_prompt: "Ask for name in one short sentence.",
                    ask_email_prompt: "Ask for email in one short sentence.",
                    complete_prompt: "Collection complete. Respond with one short sentence.",
                    system_context: "",
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
        setFormData({
            name: "",
            script: {
                instructions: "You are a helpful AI assistant. Start by greeting the user and asking for their name. Then ask for their email address. Once you have both, confirm the information and end the conversation.",
            },
            is_active: false,
        });
    };

    return (
        <div className="script-manager">
            <div className="script-manager-header">
                <h2>Behavior Script Management</h2>
                <p>Create and manage custom behavior scripts for the AI agent</p>
            </div>

            {error && <div className="alert alert-error">{error}</div>}
            {success && <div className="alert alert-success">{success}</div>}

            <div className="script-manager-content">
                <div className="script-form-section">
                    <h3>{isEditing ? "Edit Script" : "Create New Script"}</h3>
                    <form onSubmit={handleSubmit} className="script-form">
                        <div className="form-group">
                            <label htmlFor="name">Script Name *</label>
                            <input
                                type="text"
                                id="name"
                                name="name"
                                value={formData.name}
                                onChange={handleInputChange}
                                required
                                disabled={isEditing}
                                placeholder="e.g., Customer Service Script"
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="script.instructions">Agent Instructions *</label>
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
                            />
                            <small style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
                                The agent will follow these instructions exactly. Be specific about what you want it to do.
                            </small>
                        </div>

                        <div className="form-group checkbox-group">
                            <label>
                                <input
                                    type="checkbox"
                                    name="is_active"
                                    checked={formData.is_active}
                                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                                />
                                Set as active script (will deactivate all other scripts)
                            </label>
                        </div>

                        <div className="form-actions">
                            <button type="submit" className="btn btn-primary" disabled={loading}>
                                {loading ? "Saving..." : isEditing ? "Update Script" : "Create Script"}
                            </button>
                            {isEditing && (
                                <button type="button" className="btn btn-secondary" onClick={handleCancel}>
                                    Cancel
                                </button>
                            )}
                        </div>
                    </form>
                </div>

                <div className="scripts-list-section">
                    <h3>Available Scripts</h3>
                    {loading && scripts.length === 0 ? (
                        <div className="loading">Loading scripts...</div>
                    ) : scripts.length === 0 ? (
                        <div className="empty-state">No scripts found. Create your first script!</div>
                    ) : (
                        <div className="scripts-list">
                            {scripts.map((script) => (
                                <div
                                    key={script.name}
                                    className={`script-card ${script.is_active ? "active" : ""}`}
                                >
                                    <div className="script-card-header">
                                        <h4>{script.name}</h4>
                                        {script.is_active && <span className="active-badge">Active</span>}
                                    </div>
                                    <div className="script-card-body">
                                        <p>
                                            <strong>Instructions:</strong> {script.script.instructions?.substring(0, 120)}...
                                        </p>
                                        <p className="script-meta">
                                            Updated: {new Date(script.updated_at).toLocaleString()}
                                        </p>
                                    </div>
                                    <div className="script-card-actions">
                                        {!script.is_active && (
                                            <button
                                                className="btn btn-sm btn-success"
                                                onClick={() => handleActivate(script.name)}
                                            >
                                                Activate
                                            </button>
                                        )}
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => handleEdit(script)}
                                        >
                                            Edit
                                        </button>
                                        <button
                                            className="btn btn-sm btn-danger"
                                            onClick={() => handleDelete(script.name)}
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default ScriptManager;
