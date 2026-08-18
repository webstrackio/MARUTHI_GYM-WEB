import { useState, useEffect } from "react";
const DEFAULT_SETTINGS = {
    name: "",
    icon: "🏋️",
    logoImage: "",
    heroImage: "",
    accentColor: "#3b82f6",
    cropScale: 1,
    ownerEmail: "",
    ownerPassword: "",
};
const STORAGE_KEY = "gymdesk_settings";
export function useGymSettings() {
    const [settings, setSettings] = useState(DEFAULT_SETTINGS);
    const [isLoaded, setIsLoaded] = useState(false);
    // Load from localStorage on mount
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                setSettings(JSON.parse(stored));
            }
            catch (e) {
                setSettings(DEFAULT_SETTINGS);
            }
        }
        setIsLoaded(true);
    }, []);
    // Save to localStorage whenever settings change
    const updateSettings = (newSettings) => {
        const updated = { ...settings, ...newSettings };
        setSettings(updated);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    };
    return {
        settings,
        updateSettings,
        isLoaded,
    };
}
