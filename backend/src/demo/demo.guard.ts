import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { Observable } from 'rxjs';

/** Bloquea el módulo demo si DEMO_MODE no está en 'true'. */
@Injectable()
export class DemoEnabledGuard implements CanActivate {
  canActivate(): boolean | Promise<boolean> | Observable<boolean> {
    if (process.env.DEMO_MODE === 'true') {
      return true;
    }
    throw new NotFoundException('Demo no habilitada');
  }
}