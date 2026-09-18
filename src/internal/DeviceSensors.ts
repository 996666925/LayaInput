import { Quat, Vec3, quat, vec3 } from "../InputEvent";

/** 浏览器设备传感器适配器；集中管理状态与全局监听生命周期。 */
export class DeviceSensors {
  private _gravity = vec3();
  private _accelerometer = vec3();
  private _magnetometer = vec3();
  private _gyroscope = vec3();
  private _orientation = quat();
  private _motionBound = false;
  private _orientationBound = false;

  getGravity(): Vec3 {
    this._bindMotion();
    return vec3(this._gravity.x, this._gravity.y, this._gravity.z);
  }

  getAccelerometer(): Vec3 {
    this._bindMotion();
    return vec3(this._accelerometer.x, this._accelerometer.y, this._accelerometer.z);
  }

  getMagnetometer(): Vec3 {
    return vec3(this._magnetometer.x, this._magnetometer.y, this._magnetometer.z);
  }

  getGyroscope(): Vec3 {
    return vec3(this._gyroscope.x, this._gyroscope.y, this._gyroscope.z);
  }

  getOrientation(): Quat {
    this._bindOrientation();
    return quat(this._orientation.x, this._orientation.y, this._orientation.z, this._orientation.w);
  }

  setGravity(value: Vec3): void {
    this._gravity = vec3(value.x, value.y, value.z);
  }

  setAccelerometer(value: Vec3): void {
    this._accelerometer = vec3(value.x, value.y, value.z);
  }

  setMagnetometer(value: Vec3): void {
    this._magnetometer = vec3(value.x, value.y, value.z);
  }

  setGyroscope(value: Vec3): void {
    this._gyroscope = vec3(value.x, value.y, value.z);
  }

  setOrientation(value: Quat): void {
    this._orientation = quat(value.x, value.y, value.z, value.w);
  }

  unbind(): void {
    const win = typeof window !== "undefined" ? window : null;
    if (win && this._orientationBound) {
      win.removeEventListener("deviceorientation", this._onOrientation);
    }
    if (win && this._motionBound) {
      win.removeEventListener("devicemotion", this._onMotion);
    }
    this._orientationBound = false;
    this._motionBound = false;
  }

  private _bindOrientation(): void {
    if (this._orientationBound) return;
    const win = typeof window !== "undefined" ? window : null;
    if (!win || typeof win.addEventListener !== "function") return;
    win.addEventListener("deviceorientation", this._onOrientation);
    this._orientationBound = true;
  }

  private _bindMotion(): void {
    if (this._motionBound) return;
    const win = typeof window !== "undefined" ? window : null;
    if (!win || typeof win.addEventListener !== "function") return;
    win.addEventListener("devicemotion", this._onMotion);
    this._motionBound = true;
  }

  private _onOrientation = (event: DeviceOrientationEvent): void => {
    const alpha = ((event.alpha || 0) * Math.PI) / 180;
    const beta = ((event.beta || 0) * Math.PI) / 180;
    const gamma = ((event.gamma || 0) * Math.PI) / 180;
    const cx = Math.cos(beta / 2);
    const sx = Math.sin(beta / 2);
    const cy = Math.cos(gamma / 2);
    const sy = Math.sin(gamma / 2);
    const cz = Math.cos(alpha / 2);
    const sz = Math.sin(alpha / 2);

    this._orientation = quat(
      sx * cy * cz + cx * sy * sz,
      cx * sy * cz - sx * cy * sz,
      cx * cy * sz - sx * sy * cz,
      cx * cy * cz + sx * sy * sz
    );
  };

  private _onMotion = (event: DeviceMotionEvent): void => {
    const gravity = event.accelerationIncludingGravity;
    if (gravity) {
      this._gravity = vec3(gravity.x ? -gravity.x : 0, gravity.y ? -gravity.y : 0, gravity.z ? -gravity.z : 0);
    }
    const acceleration = event.acceleration;
    if (acceleration) {
      this._accelerometer = vec3(
        acceleration.x ? -acceleration.x : 0,
        acceleration.y ? -acceleration.y : 0,
        acceleration.z ? -acceleration.z : 0
      );
    }
    const rotation = event.rotationRate;
    if (rotation) {
      this._gyroscope = vec3(
        rotation.alpha ? -rotation.alpha * 0.01 : 0,
        rotation.beta ? -rotation.beta * 0.01 : 0,
        rotation.gamma ? -rotation.gamma * 0.01 : 0
      );
    }
  };
}

export const deviceSensors = new DeviceSensors();
