package transfer

import (
	"context"
	"errors"
	"fmt"
)

type globalEngineController interface {
	PauseAll(context.Context) error
	ResumeAll(context.Context) error
}

type aria2GlobalController interface {
	PauseAll(context.Context) error
	UnpauseAll(context.Context) error
}

func (service *Service) PauseAll(ctx context.Context) error {
	return service.controlAll(ctx, true)
}

func (service *Service) ResumeAll(ctx context.Context) error {
	return service.controlAll(ctx, false)
}

func (service *Service) controlAll(ctx context.Context, pause bool) error {
	service.queueMu.Lock()
	defer service.queueMu.Unlock()
	runtime, _, err := service.running()
	if err != nil {
		return err
	}
	controller, ok := runtime.Engine.(globalEngineController)
	if !ok {
		return errors.New("transfer engine does not support global queue control")
	}
	if pause {
		return controller.PauseAll(ctx)
	}
	return controller.ResumeAll(ctx)
}

func (engine *aria2Engine) PauseAll(ctx context.Context) error {
	controller, ok := engine.rpc.(aria2GlobalController)
	if !ok {
		return errors.New("aria2 RPC client does not support pause-all")
	}
	if err := controller.PauseAll(ctx); err != nil {
		return err
	}
	if err := engine.rpc.SaveSession(ctx); err != nil {
		return fmt.Errorf("%w: save aria2 session after pause-all: %v", ErrQueueStateNotPersisted, err)
	}
	return nil
}

func (engine *aria2Engine) ResumeAll(ctx context.Context) error {
	controller, ok := engine.rpc.(aria2GlobalController)
	if !ok {
		return errors.New("aria2 RPC client does not support resume-all")
	}
	if err := controller.UnpauseAll(ctx); err != nil {
		return err
	}
	if err := engine.rpc.SaveSession(ctx); err != nil {
		return fmt.Errorf("%w: save aria2 session after resume-all: %v", ErrQueueStateNotPersisted, err)
	}
	return nil
}

func (client *rpcClient) PauseAll(ctx context.Context) error {
	_, err := client.call(ctx, "aria2.pauseAll")
	return err
}

func (client *rpcClient) UnpauseAll(ctx context.Context) error {
	_, err := client.call(ctx, "aria2.unpauseAll")
	return err
}
