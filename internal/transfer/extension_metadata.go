package transfer

import "errors"

// ConfiguredAria2Path reads only the configured engine path. Unlike Snapshot,
// it never contacts a running engine or reconciles persisted queue/history data.
func (service *Service) ConfiguredAria2Path() (string, error) {
	if service == nil {
		return "", errors.New("downloader service is unavailable")
	}
	service.mu.RLock()
	config, store := service.config, service.configStore
	running := service.runtime != nil || service.starting || service.stopping
	service.mu.RUnlock()
	if !running && store != nil {
		diskConfig, _, _, err := store.LoadWithRevision()
		if err != nil {
			return "", err
		}
		config = diskConfig
	}
	return config.Aria2Path, nil
}
